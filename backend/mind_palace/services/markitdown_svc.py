"""Server-side document parsing via MarkItDown (+ embedded-image extraction)."""
import os
import re
import uuid
import zipfile
import tempfile
import logging
import mimetypes
from pathlib import Path
from dataclasses import dataclass, field

from mind_palace.config import settings

log = logging.getLogger(__name__)

_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".emf", ".wmf"}


@dataclass
class ParsedDocument:
    text: str
    images: list[dict] = field(default_factory=list)  # [{path, filename, mime_type, size}]


def _write_img(out_dir: str, name: str, data: bytes) -> dict:
    dest = Path(out_dir) / name
    dest.write_bytes(data)
    mime, _ = mimetypes.guess_type(name)
    return {"path": str(dest), "filename": name, "mime_type": mime or "image/png", "size": len(data)}


def _parse_pdf_positioned(file_path: str | Path, out_dir: str) -> tuple[str, list[dict]]:
    """Extract a PDF page-by-page with pypdf so each embedded image keeps its place:
    returns text containing `<<image:N>>` placeholders where the Nth image appears,
    and the ordered image list. The worker swaps the placeholders for real
    `<<attachment:UUID>>` tokens once the attachments are saved."""
    parts: list[str] = []
    images: list[dict] = []
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(file_path))
        for pi, page in enumerate(reader.pages, 1):
            try:
                txt = (page.extract_text() or "").strip()
                if txt:
                    parts.append(txt)
                for img in page.images:
                    data = getattr(img, "data", None)
                    if not data:
                        continue
                    ext = os.path.splitext(img.name or "")[1].lower() or ".png"
                    if ext not in _IMAGE_EXTS:
                        ext = ".png"
                    idx = len(images)
                    images.append(_write_img(out_dir, f"page{pi}_img{idx}{ext}", data))
                    parts.append(f"<<image:{idx}>>")
            except Exception as e:  # a single bad page shouldn't lose the rest
                log.warning("PDF page %d extraction failed: %s", pi, e)
    except Exception as e:
        log.warning("PDF extraction unavailable: %s", e)
    return "\n\n".join(parts), images


def _extract_zip_media(file_path: str | Path, out_dir: str, prefixes: tuple) -> list[dict]:
    """Office formats (docx/pptx/xlsx) are zips — pull images from their media/ folders."""
    images = []
    try:
        with zipfile.ZipFile(file_path) as z:
            for info in z.namelist():
                if info.endswith("/") or not any(info.startswith(p) for p in prefixes):
                    continue
                if os.path.splitext(info)[1].lower() not in _IMAGE_EXTS:
                    continue
                images.append(_write_img(out_dir, os.path.basename(info), z.read(info)))
    except Exception as e:
        log.warning("media extraction failed for %s: %s", file_path, e)
    return images


def parse_file(file_path: str | Path) -> ParsedDocument:
    """Parse a document to markdown text, and extract its embedded images.

    MarkItDown handles text; images embedded *within* a page (PDF, docx, pptx,
    xlsx) are extracted separately so they're preserved as attachments in every
    mode — independent of whether the page was fully OCR'd.
    """
    def _markitdown_text() -> str:
        try:
            from markitdown import MarkItDown
        except ImportError:
            raise RuntimeError("markitdown not installed. Run: pip install markitdown[all]")
        return MarkItDown().convert(str(file_path)).text_content or ""

    ext = Path(file_path).suffix.lower()
    out_dir = tempfile.mkdtemp(prefix="mp_img_")

    if ext == ".pdf":
        # MarkItDown (pdfminer) is the authoritative text source — pypdf's
        # extract_text fails on many real PDFs. Keep pypdf's POSITIONED layout
        # only when its text is essentially complete; otherwise use MarkItDown's
        # text and place the image tokens at the end (text never gets dropped).
        pos_text, images = _parse_pdf_positioned(file_path, out_dir)
        md_text = _markitdown_text()
        plain = re.sub(r"<<image:\d+>>", "", pos_text).strip()
        md_len = len(md_text.strip())
        if images and plain and (md_len == 0 or len(plain) >= 0.8 * md_len):
            text = pos_text                      # pypdf captured the text well → positioned
        else:
            text = md_text.rstrip()              # trust MarkItDown's text
            if images:
                text += "\n\n" + "\n\n".join(f"<<image:{i}>>" for i in range(len(images)))
    else:
        text = _markitdown_text()
        if ext == ".docx":
            images = _extract_zip_media(file_path, out_dir, ("word/media/",))
        elif ext == ".pptx":
            images = _extract_zip_media(file_path, out_dir, ("ppt/media/",))
        elif ext == ".xlsx":
            images = _extract_zip_media(file_path, out_dir, ("xl/media/",))
        else:
            images = []
        # Office formats: positions aren't recoverable from the zip, so place the
        # image tokens at the end (the worker turns them into attachments).
        if images:
            text = text.rstrip() + "\n\n" + "\n\n".join(f"<<image:{i}>>" for i in range(len(images)))

    log.info("parse_file: %s → %d chars, %d embedded image(s)", Path(file_path).name, len(text), len(images))
    return ParsedDocument(text=text, images=images)


def save_blob(data: bytes, owner_id: uuid.UUID, collection_id: uuid.UUID, object_id: uuid.UUID, filename: str) -> str:
    """Save raw file blob and return its storage path."""
    blob_dir = Path(settings.blob_storage_path) / "raw" / str(owner_id) / str(collection_id)
    blob_dir.mkdir(parents=True, exist_ok=True)
    dest = blob_dir / f"{object_id}_{filename}"
    dest.write_bytes(data)
    dest.chmod(0o400)
    return str(dest)


def save_attachment_blob(data: bytes, owner_id: uuid.UUID, object_id: uuid.UUID, attachment_id: uuid.UUID, filename: str) -> str:
    """Save an attachment blob and return its storage path."""
    blob_dir = Path(settings.blob_storage_path) / "attachments" / str(owner_id) / str(object_id)
    blob_dir.mkdir(parents=True, exist_ok=True)
    dest = blob_dir / f"{attachment_id}_{filename}"
    dest.write_bytes(data)
    dest.chmod(0o400)
    return str(dest)


def chunk_text(text: str, max_tokens: int = 512, overlap_tokens: int = 64) -> list[dict]:
    """Split text into overlapping chunks with metadata."""
    try:
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        tokens = enc.encode(text)
        decode = enc.decode
    except Exception:
        # Fallback: rough word-based chunking
        words = text.split()
        token_approx = words
        tokens = words

        def decode(t):
            return " ".join(t)

    chunks = []
    start = 0
    idx = 0
    while start < len(tokens):
        end = min(start + max_tokens, len(tokens))
        chunk_tokens = tokens[start:end]
        chunk_text = decode(chunk_tokens) if callable(decode) else " ".join(chunk_tokens)
        chunks.append({
            "chunk_index": idx,
            "content": chunk_text.strip(),
            "metadata": {"start_token": start, "end_token": end},
        })
        idx += 1
        start += max_tokens - overlap_tokens
        if end == len(tokens):
            break

    return chunks
