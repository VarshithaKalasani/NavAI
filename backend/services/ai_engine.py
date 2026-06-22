import os
import base64
import logging
from typing import List, Optional

from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from schemas import DOMNode, NavigationResponse, VisionResponse

load_dotenv()

logger = logging.getLogger("navai.ai_engine")

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

if not GOOGLE_API_KEY:
    logger.warning(
        "GOOGLE_API_KEY is not set. Set it in a .env file before making requests. "
        "See the setup guide for how to get a free key from Google AI Studio."
    )

# ---------------------------------------------------------------------------
class _DomMatchResult(BaseModel):
    found: bool = Field(..., description="True if a confident matching element was found in the DOM snapshot.")
    target_id: Optional[str] = Field(None, description="The id of the matched element, copied exactly from the snapshot. Null if not found.")
    spoken_response: str = Field(..., description="A short, natural sentence to read aloud to the user describing what was done or why nothing was found.")


class _VisionMatchResult(BaseModel):
    found: bool = Field(..., description="True if a matching region was identified in the screenshot.")
    x: Optional[int] = Field(None, description="Pixel X coordinate (from the left edge) of the center of the target element.")
    y: Optional[int] = Field(None, description="Pixel Y coordinate (from the top edge) of the center of the target element.")
    spoken_response: str = Field(..., description="A short, natural sentence to read aloud to the user.")


def _get_llm(temperature: float = 0.0) -> ChatGoogleGenerativeAI:
    """Factory for the LangChain chat model. Kept as a function (not a module
    singleton) so API key issues surface clearly per-request instead of at
    import time, which is friendlier when running interactively."""
    if not GOOGLE_API_KEY:
        raise RuntimeError(
            "GOOGLE_API_KEY is missing. Create a .env file in backend/ with "
            "GOOGLE_API_KEY=your_key_here (see setup guide)."
        )
    return ChatGoogleGenerativeAI(
        model=GEMINI_MODEL,
        google_api_key=GOOGLE_API_KEY,
        temperature=temperature,
    )


_DOM_SYSTEM_PROMPT = """You are NavAI's semantic parser, an assistant that helps visually \
impaired users navigate websites by voice.

You will receive:
1. A natural-language navigation command from the user (e.g. "take me to checkout", \
"read me the pricing section", "click the search button").
2. A JSON array of DOM nodes extracted from the current web page. Each node has:
   - id: a unique identifier for the element
   - tag: the HTML tag (a, button, input, h1-h6, nav, section, etc.)
   - text: the visible text or label of the element (may be null)
   - placeholder: placeholder text, for input fields only (may be null)

Your job: find the SINGLE element in the DOM snapshot that best matches the user's intent.

Rules:
- Match based on meaning, not exact string matching. "Take me to checkout" should match \
an element with text like "Checkout", "Proceed to Payment", or a cart/checkout-related link.
- Prefer the most specific, most relevant element. If multiple elements could match, \
pick the one most likely to fulfill the user's actual goal.
- If NO element in the snapshot is a reasonable match, set found to false. Do not guess \
or force a low-confidence match — it is better to say "not found" than to send the user \
to the wrong place.
- Always copy the "id" field EXACTLY as it appears in the snapshot — never invent or \
modify an id.
- spoken_response must be ONE short, natural sentence (under 20 words) suitable for \
text-to-speech. If found, briefly describe what you're taking the user to. If not found, \
say so plainly, e.g. "I couldn't find that on the page from its layout, let me look more closely."

{format_instructions}
"""

_dom_parser = PydanticOutputParser(pydantic_object=_DomMatchResult)

_dom_prompt = ChatPromptTemplate.from_messages(
    [
        ("system", _DOM_SYSTEM_PROMPT),
        ("human", "User command: \"{command}\"\n\nDOM snapshot:\n{dom_snapshot_json}"),
    ]
).partial(format_instructions=_dom_parser.get_format_instructions())


def resolve_dom_command(command: str, dom_snapshot: List[DOMNode]) -> NavigationResponse:
    """
    Core DOM reasoning step (Gemini Flash via LangChain).
    Returns a NavigationResponse with action_type SCROLL_TO (match found) or
    CAPTURE_SCREEN (no confident DOM match -> caller should trigger the
    vision fallback).
    """
    if not dom_snapshot:
        return NavigationResponse(
            target_id=None,
            action_type="CAPTURE_SCREEN",
            spoken_response="The page structure looks empty, let me look at it visually instead.",
        )

    dom_snapshot_json = _serialize_snapshot(dom_snapshot)

    llm = _get_llm(temperature=0.0)
    chain = _dom_prompt | llm | _dom_parser

    try:
        result: _DomMatchResult = chain.invoke(
            {"command": command, "dom_snapshot_json": dom_snapshot_json}
        )
    except Exception as exc:
        logger.exception("DOM reasoning chain failed: %s", exc)
        # Fail safe: route to vision fallback rather than crashing the request.
        return NavigationResponse(
            target_id=None,
            action_type="CAPTURE_SCREEN",
            spoken_response="I had trouble reading the page structure, let me try looking at it visually.",
        )

    if result.found and result.target_id:
        return NavigationResponse(
            target_id=result.target_id,
            action_type="SCROLL_TO",
            spoken_response=result.spoken_response,
        )

    # No confident match -> signal the frontend to fall back to vision.
    return NavigationResponse(
        target_id=None,
        action_type="CAPTURE_SCREEN",
        spoken_response=result.spoken_response or "I couldn't find that from the page structure, checking visually now.",
    )


def _serialize_snapshot(dom_snapshot: List[DOMNode]) -> str:
    """Compact JSON serialization to keep token usage low."""
    import json

    compact = [
        {k: v for k, v in node.model_dump().items() if v is not None}
        for node in dom_snapshot
    ]
    return json.dumps(compact, separators=(",", ":"))


_VISION_SYSTEM_PROMPT = """You are NavAI's vision fallback engine. You help visually impaired \
users navigate websites when the page's HTML structure didn't give a confident match.

You will receive a screenshot of the user's current browser viewport and their natural-language \
navigation command (e.g. "go to the pricing section", "click the search icon").

Your job:
- Visually locate the single UI element or section on the screenshot that best matches the command.
- Return the PIXEL coordinates (x, y) of the CENTER of that element, measured from the top-left \
corner of the image (x = 0 at the left edge, y = 0 at the top edge).
- If you cannot find anything reasonably matching the command in the screenshot, set found to false.
- spoken_response must be ONE short, natural sentence (under 20 words) suitable for text-to-speech.

Respond ONLY with the structured JSON described below — no extra commentary.

{format_instructions}
"""

_vision_parser = PydanticOutputParser(pydantic_object=_VisionMatchResult)


def resolve_vision_command(command: str, image_base64: str) -> VisionResponse:
    """
    Vision fallback step (Gemini Flash multimodal via LangChain).
    Takes a base64 screenshot + the user's command, returns click/scroll
    coordinates for the frontend to act on.
    """
    llm = _get_llm(temperature=0.0)

    format_instructions = _vision_parser.get_format_instructions()
    system_text = _VISION_SYSTEM_PROMPT.format(format_instructions=format_instructions)

    # Strip a data-URL prefix if the caller accidentally included one.
    if image_base64.startswith("data:"):
        image_base64 = image_base64.split(",", 1)[-1]

    message = HumanMessage(
        content=[
            {"type": "text", "text": f"{system_text}\n\nUser command: \"{command}\""},
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"},
            },
        ]
    )

    try:
        raw_result = llm.invoke([message])
        result: _VisionMatchResult = _vision_parser.parse(raw_result.content)
    except Exception as exc:
        logger.exception("Vision reasoning chain failed: %s", exc)
        return VisionResponse(
            x=None,
            y=None,
            spoken_response="Sorry, I had trouble analyzing the page visually. Please try rephrasing your command.",
        )

    if result.found and result.x is not None and result.y is not None:
        return VisionResponse(x=result.x, y=result.y, spoken_response=result.spoken_response)

    return VisionResponse(
        x=None,
        y=None,
        spoken_response=result.spoken_response or "I couldn't find that on the page, even after looking visually.",
    )
