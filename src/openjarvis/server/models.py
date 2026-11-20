"""Pydantic request/response models for the OpenAI-compatible API."""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: str
    content: str = ""
    name: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    tool_call_id: Optional[str] = None
    # Base64-encoded image payloads for vision-capable local engines.
    images: Optional[List[str]] = Field(default=None, max_length=4)

    @field_validator("images")
    @classmethod
    def validate_images(cls, images: Optional[List[str]]) -> Optional[List[str]]:
        if images is None:
            return None
        import base64
        import binascii

        total_bytes = 0
        for image in images:
            if not image or len(image) > 8 * 1024 * 1024:
                raise ValueError("Each image must be non-empty and no larger than 6 MiB.")
            try:
                decoded = base64.b64decode(image, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise ValueError("Images must be raw base64-encoded image bytes.") from exc
            if len(decoded) > 6 * 1024 * 1024:
                raise ValueError("Each image must be no larger than 6 MiB.")
            total_bytes += len(decoded)
        if total_bytes > 12 * 1024 * 1024:
            raise ValueError("Combined image payload must not exceed 12 MiB.")
        return images


class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    temperature: float = 0.7
    max_tokens: int = 1024
    stream: bool = False
    tools: Optional[List[Dict[str, Any]]] = None
    # Optional per-request override used by the first-party client. `None`
    # keeps OpenAI-compatible callers on the server's configured default.
    memory_context: Optional[bool] = None
    conversation_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class UsageInfo(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class AudioMeta(BaseModel):
    url: str


class ChoiceMessage(BaseModel):
    role: str = "assistant"
    content: Optional[str] = ""
    tool_calls: Optional[List[Dict[str, Any]]] = None
    audio: Optional[AudioMeta] = None


class Choice(BaseModel):
    index: int = 0
    message: ChoiceMessage
    finish_reason: str = "stop"


class ComplexityInfo(BaseModel):
    score: float
    tier: str
    suggested_max_tokens: int


class ChatCompletionResponse(BaseModel):
    id: str = Field(default_factory=lambda: f"chatcmpl-{uuid.uuid4().hex[:12]}")
    object: str = "chat.completion"
    created: int = Field(default_factory=lambda: int(time.time()))
    model: str = ""
    choices: List[Choice] = Field(default_factory=list)
    usage: UsageInfo = Field(default_factory=UsageInfo)
    complexity: Optional[ComplexityInfo] = None


# ---------------------------------------------------------------------------
# Streaming chunk models
# ---------------------------------------------------------------------------


class DeltaMessage(BaseModel):
    role: Optional[str] = None
    content: Optional[str] = None
    # Streaming tool_calls (OpenAI delta shape, with `index`). Present only
    # on streamed raw function-calling responses (stream:true + tools).
    tool_calls: Optional[List[Dict[str, Any]]] = None


class StreamChoice(BaseModel):
    index: int = 0
    delta: DeltaMessage
    finish_reason: Optional[str] = None


class ChatCompletionChunk(BaseModel):
    id: str = ""
    object: str = "chat.completion.chunk"
    created: int = Field(default_factory=lambda: int(time.time()))
    model: str = ""
    choices: List[StreamChoice] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Models endpoint
# ---------------------------------------------------------------------------


class ModelObject(BaseModel):
    id: str
    object: str = "model"
    created: int = Field(default_factory=lambda: int(time.time()))
    owned_by: str = "openjarvis"


class ModelListResponse(BaseModel):
    object: str = "list"
    data: List[ModelObject] = Field(default_factory=list)


__all__ = [
    "ChatCompletionChunk",
    "ChatCompletionRequest",
    "ChatCompletionResponse",
    "ChatMessage",
    "Choice",
    "ChoiceMessage",
    "ComplexityInfo",
    "DeltaMessage",
    "ModelListResponse",
    "ModelObject",
    "StreamChoice",
    "UsageInfo",
]
