from pydantic import model_validator, AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal


DeploymentMode = Literal["light", "standard", "advanced"]
_MODE_LEVEL = {"light": 1, "standard": 2, "advanced": 3}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = "postgresql+asyncpg://mindpalace:mindpalace@localhost:5432/mindpalace"
    database_url_sync: str = "postgresql://mindpalace:mindpalace@localhost:5432/mindpalace"

    # App
    app_name: str = "Mind Palace v2"
    secret_key: str = "change-me-in-production-use-32-chars-minimum"
    debug: bool = False
    environment: Literal["development", "production"] = "production"
    # Expose interactive API docs (/docs, /redoc). Off in production by default.
    enable_docs: bool = False

    # Database pool tuning
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_timeout: int = 30
    db_pool_recycle: int = 1800

    # Deployment mode: light | standard | advanced.
    #  light    — regex NER, no embeddings (runs on any laptop, no models)
    #  standard — async worker + embeddings
    #  advanced — + vision parsing + LLM entity extraction
    deployment_mode: DeploymentMode = Field(
        default="standard",
        validation_alias=AliasChoices("DEPLOYMENT_MODE", "deployment_mode"),
    )

    @property
    def mode_level(self) -> int:
        """Ordinal for feature gating: light=1, standard=2, advanced=3."""
        return _MODE_LEVEL[self.deployment_mode]

    # ── Inference providers (OpenAI-compatible) ──────────────────────────────
    # Every provider speaks the OpenAI API (`/embeddings`, `/chat/completions`),
    # so each can point independently at a local Ollama, OpenAI, or any
    # compatible remote endpoint. `inference_base_url` / `inference_api_key` are
    # shared defaults; override a provider's url/key to split it onto its own host.
    inference_base_url: str = "http://localhost:11434/v1"
    inference_api_key: str = "not-needed"

    # Embedding provider (text → vector)
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = "nomic-embed-text"
    embedding_dimensions: int = 768

    # LLM provider (text generation: entity extraction, summaries…)
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "gemma4:e4b"

    # OCR / vision provider (image → text)
    ocr_base_url: str = ""
    ocr_api_key: str = ""
    ocr_model: str = "gemma4:e4b"

    @model_validator(mode="after")
    def _fill_provider_defaults(self):
        # Each provider inherits the shared inference_base_url / api_key unless
        # explicitly overridden, so a single endpoint configures everything while
        # any provider can be split onto its own host.
        for p in ("embedding", "llm", "ocr"):
            if not getattr(self, f"{p}_base_url"):
                setattr(self, f"{p}_base_url", self.inference_base_url)
            if not getattr(self, f"{p}_api_key"):
                setattr(self, f"{p}_api_key", self.inference_api_key)
        return self

    # Inference HTTP timeouts (seconds). Short connect → fast-fail on a bad/down
    # endpoint; generous read windows for slow generation.
    inference_connect_timeout: float = 5.0
    embedding_timeout: float = 60.0
    ocr_timeout: float = 180.0
    llm_timeout: float = 45.0
    parse_timeout: float = 120.0   # max seconds to parse one document before failing

    # Blob storage
    blob_storage_path: str = "/var/lib/mindpalace/blobs"

    # Worker
    worker_poll_interval_seconds: float = 1.0
    worker_concurrency: int = 2

    # CORS
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    # AGE graph
    age_graph_name: str = "mind_palace_graph"


settings = Settings()
