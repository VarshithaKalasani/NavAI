from typing import List, Optional, Literal
from pydantic import BaseModel, Field


class DOMNode(BaseModel):
    """A single interactive/navigable element extracted from the page DOM."""

    id: str = Field(..., description="The data-navai-id (or native id) of the element.")
    tag: str = Field(..., description="The HTML tag name, e.g. 'button', 'a', 'h2'.")
    text: Optional[str] = Field(None, description="Visible/aria-label text of the element.")
    placeholder: Optional[str] = Field(None, description="Placeholder text, for inputs only.")


class NavigationRequest(BaseModel):
    """Incoming request: user's spoken command + a snapshot of the live DOM."""

    command: str = Field(..., description="The user's natural language navigation command.")
    dom_snapshot: List[DOMNode] = Field(default_factory=list, description="Lightweight DOM snapshot.")


class VisionRequest(BaseModel):
    """Incoming request for the vision fallback path."""

    command: str = Field(..., description="The user's natural language navigation command.")
    image_base64: str = Field(..., description="Base64-encoded JPEG/PNG screenshot of the visible tab.")


class NavigationResponse(BaseModel):
    """Response returned to the extension after DOM-based reasoning."""

    target_id: Optional[str] = Field(None, description="The matched element's data-navai-id, if found.")
    action_type: Literal["SCROLL_TO", "CAPTURE_SCREEN", "NONE"] = Field(
        ..., description="What the extension should do next."
    )
    spoken_response: str = Field(..., description="Short text to read aloud to the user via TTS.")


class VisionResponse(BaseModel):
    """Response returned after the vision (screenshot) fallback path."""

    x: Optional[int] = Field(None, description="Normalized-to-pixel X coordinate of the target element.")
    y: Optional[int] = Field(None, description="Normalized-to-pixel Y coordinate of the target element.")
    spoken_response: str = Field(..., description="Short text to read aloud to the user via TTS.")
