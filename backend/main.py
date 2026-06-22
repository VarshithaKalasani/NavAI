import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from schemas import NavigationRequest, NavigationResponse, VisionRequest, VisionResponse
from services import ai_engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("navai.main")

app = FastAPI(
    title="NavAI Backend",
    description="AI orchestration backend for the NavAI accessible web navigator Chrome extension.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health_check():
    """Simple liveness check — also handy for confirming the server is up."""
    return {"status": "ok", "service": "NavAI Backend", "version": "1.0.0"}


@app.post("/api/v1/navigate", response_model=NavigationResponse)
def navigate(request: NavigationRequest):
    if not request.command or not request.command.strip():
        raise HTTPException(status_code=400, detail="command must not be empty.")

    try:
        result = ai_engine.resolve_dom_command(request.command, request.dom_snapshot)
        return result
    except RuntimeError as e:
        # Typically a missing/invalid API key — surface a clear message.
        logger.error("Configuration error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected error in /navigate: %s", e)
        raise HTTPException(status_code=500, detail="Internal error while resolving navigation command.")


@app.post("/api/v1/navigate-vision", response_model=VisionResponse)
def navigate_vision(request: VisionRequest):
    """
    Vision fallback endpoint. Takes the user's command + a base64-encoded
    screenshot of the visible tab, and asks the Gemini-backed vision engine
    for pixel coordinates of the best-matching element/region.
    """
    if not request.command or not request.command.strip():
        raise HTTPException(status_code=400, detail="command must not be empty.")
    if not request.image_base64:
        raise HTTPException(status_code=400, detail="image_base64 must not be empty.")

    try:
        result = ai_engine.resolve_vision_command(request.command, request.image_base64)
        return result
    except RuntimeError as e:
        logger.error("Configuration error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.exception("Unexpected error in /navigate-vision: %s", e)
        raise HTTPException(status_code=500, detail="Internal error while resolving vision command.")
