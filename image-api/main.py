"""
Image Generation API Service

獨立的 HTTP API 服務，運行在 port 8004
使用 Qwen-Image 擴散模型生成圖像
支援 prompt-to-image 生成
"""

import os
import io
import uuid
import base64
import asyncio
from datetime import datetime
from typing import Optional
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

import torch
from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ============ Configuration ============

MODEL_NAME = os.environ.get("IMAGE_MODEL", "Qwen/Qwen-Image")
DEVICE = os.environ.get("DEVICE", "cuda")
OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "./generated_images")

# ============ Models ============

class ImageGenerationRequest(BaseModel):
    prompt: str
    negative_prompt: Optional[str] = ""
    width: int = 1024
    height: int = 1024
    num_inference_steps: int = 50
    guidance_scale: float = 4.0
    seed: Optional[int] = None
    output_format: str = "base64"  # base64, url, or file

class ImageGenerationResponse(BaseModel):
    success: bool
    image: Optional[str] = None
    image_url: Optional[str] = None
    seed: int
    generation_time: float
    message: str = ""

# ============ Global State ============

pipe = None
executor = ThreadPoolExecutor(max_workers=2)

def load_model():
    """Load Qwen-Image model"""
    global pipe

    print(f"🚀 Loading Qwen-Image model: {MODEL_NAME}")

    try:
        from diffusers import DiffusionPipeline

        pipe = DiffusionPipeline.from_pretrained(
            MODEL_NAME,
            torch_dtype=torch.bfloat16,
            trust_remote_code=True
        )
        pipe = pipe.to(DEVICE)

        # Enable memory optimizations
        pipe.enable_attention_slicing()

        print(f"✅ Qwen-Image model loaded successfully")
        return True

    except Exception as e:
        print(f"❌ Failed to load model: {e}")
        return False

def generate_image_sync(
    prompt: str,
    negative_prompt: str = "",
    width: int = 1024,
    height: int = 1024,
    num_inference_steps: int = 50,
    guidance_scale: float = 4.0,
    seed: Optional[int] = None
) -> tuple[Image.Image, int]:
    """Synchronous image generation function"""
    global pipe

    if pipe is None:
        raise RuntimeError("Model not loaded")

    # Set seed
    if seed is None:
        seed = torch.randint(0, 2**32, (1,)).item()

    generator = torch.Generator(device=DEVICE).manual_seed(seed)

    # Generate image
    result = pipe(
        prompt=prompt,
        negative_prompt=negative_prompt if negative_prompt else None,
        width=width,
        height=height,
        num_inference_steps=num_inference_steps,
        guidance_scale=guidance_scale,
        generator=generator
    )

    image = result.images[0]
    return image, seed

async def generate_image_async(
    prompt: str,
    negative_prompt: str = "",
    width: int = 1024,
    height: int = 1024,
    num_inference_steps: int = 50,
    guidance_scale: float = 4.0,
    seed: Optional[int] = None
) -> tuple[Image.Image, int]:
    """Async wrapper for image generation"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        executor,
        generate_image_sync,
        prompt,
        negative_prompt,
        width,
        height,
        num_inference_steps,
        guidance_scale,
        seed
    )

# ============ Lifespan ============

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Don't load model at startup - load lazily on first request
    print("⚠️  Model will be loaded on first request")

    yield

    # Shutdown
    global pipe
    if pipe is not None:
        del pipe
        torch.cuda.empty_cache()
        print("Image API shutdown complete")

# ============ App ============

app = FastAPI(
    title="Image Generation API",
    description="Qwen-Image based image generation service",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ Routes ============

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy" if pipe is not None else "model_not_loaded",
        "service": "Image Generation API",
        "port": 8004,
        "model": MODEL_NAME,
        "device": DEVICE,
        "gpu_memory_allocated": f"{torch.cuda.memory_allocated() / 1024**3:.2f} GB" if torch.cuda.is_available() else "N/A",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/generate", response_model=ImageGenerationResponse)
async def generate_image(request: ImageGenerationRequest):
    """Generate image from text prompt"""
    global pipe

    # Load model if not loaded
    if pipe is None:
        if not load_model():
            raise HTTPException(
                status_code=503,
                detail="Model failed to load. Please check GPU memory."
            )

    start_time = datetime.now()

    try:
        # Generate image
        image, seed = await generate_image_async(
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            width=request.width,
            height=request.height,
            num_inference_steps=request.num_inference_steps,
            guidance_scale=request.guidance_scale,
            seed=request.seed
        )

        generation_time = (datetime.now() - start_time).total_seconds()

        # Process output based on format
        if request.output_format == "base64":
            # Convert to base64
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode()

            return ImageGenerationResponse(
                success=True,
                image=f"data:image/png;base64,{image_base64}",
                seed=seed,
                generation_time=generation_time,
                message=f"Image generated in {generation_time:.2f}s"
            )

        elif request.output_format == "file":
            # Save to file and return URL
            filename = f"{uuid.uuid4()}.png"
            filepath = os.path.join(OUTPUT_DIR, filename)
            image.save(filepath, "PNG")

            return ImageGenerationResponse(
                success=True,
                image_url=f"/images/{filename}",
                seed=seed,
                generation_time=generation_time,
                message=f"Image saved to {filepath}"
            )
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown output format: {request.output_format}"
            )

    except Exception as e:
        print(f"❌ Image generation error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Image generation failed: {str(e)}"
        )

@app.post("/generate/stream")
async def generate_image_stream(request: ImageGenerationRequest):
    """Generate image with streaming progress updates"""
    global pipe

    # Load model if not loaded
    if pipe is None:
        if not load_model():
            raise HTTPException(
                status_code=503,
                detail="Model failed to load. Please check GPU memory."
            )

    async def stream_generator():
        import json

        # Send start event
        yield f"data: {json.dumps({'type': 'start', 'message': 'Starting generation...'})}\n\n"

        try:
            start_time = datetime.now()

            # Generate image
            image, seed = await generate_image_async(
                prompt=request.prompt,
                negative_prompt=request.negative_prompt,
                width=request.width,
                height=request.height,
                num_inference_steps=request.num_inference_steps,
                guidance_scale=request.guidance_scale,
                seed=request.seed
            )

            generation_time = (datetime.now() - start_time).total_seconds()

            # Convert to base64
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.getvalue()).decode()

            # Send final result
            yield f"data: {json.dumps({'type': 'complete', 'image': f'data:image/png;base64,{image_base64}', 'seed': seed, 'generation_time': generation_time})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        stream_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        }
    )

@app.get("/images/{filename}")
async def get_image(filename: str):
    """Serve generated images"""
    filepath = os.path.join(OUTPUT_DIR, filename)

    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Image not found")

    return StreamingResponse(
        open(filepath, "rb"),
        media_type="image/png"
    )

@app.post("/unload")
async def unload_model():
    """Unload model to free GPU memory"""
    global pipe

    if pipe is not None:
        del pipe
        pipe = None
        torch.cuda.empty_cache()

        return {
            "success": True,
            "message": "Model unloaded successfully",
            "gpu_memory_freed": True
        }

    return {
        "success": True,
        "message": "No model was loaded"
    }

@app.post("/load")
async def reload_model():
    """Reload the model"""
    global pipe

    # Unload existing model first
    if pipe is not None:
        del pipe
        pipe = None
        torch.cuda.empty_cache()

    if load_model():
        return {
            "success": True,
            "message": "Model loaded successfully"
        }
    else:
        raise HTTPException(
            status_code=503,
            detail="Failed to load model"
        )

# ============ Main ============

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)
