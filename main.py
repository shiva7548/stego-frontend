import os
import io
import sys
import torch
import torch.nn.functional as F
from PIL import Image
import timm
from torchvision import transforms
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="Steganalysis Forensic API", version="1.0")

# Enable CORS for Vercel / Netlify frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins (Vercel, Netlify, localhost)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Model Configuration & Initialization
# ---------------------------------------------------------------------------
TIMM_MODEL = "tf_efficientnet_b3.ns_jft_in1k"
NUM_CLASSES = 4
INPUT_SIZE = 512
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

CLASS_LABELS = ["Cover", "JMiPOD", "JUNIWARD", "UERD"]
STEGO_LABELS = ["JMiPOD", "JUNIWARD", "UERD"]

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

TRANSFORM = transforms.Compose([
    transforms.Resize((INPUT_SIZE, INPUT_SIZE), interpolation=transforms.InterpolationMode.BICUBIC),
    transforms.ToTensor(),
    transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])

MODEL = None
LOAD_ERROR = None

def find_weights_path() -> str | None:
    candidates = [
        os.environ.get("STEGO_CKPT"),
        "efficientnet_b3_alaska2_final.pth",
        "models/efficientnet_b3_alaska2_final.pth",
        os.path.join(os.path.dirname(__file__), "efficientnet_b3_alaska2_final.pth"),
        os.path.join(os.path.dirname(__file__), "models", "efficientnet_b3_alaska2_final.pth"),
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return os.path.abspath(c)
    return None

def load_stego_model():
    global MODEL, LOAD_ERROR
    weights_path = find_weights_path()
    if not weights_path:
        LOAD_ERROR = "Model weights file (efficientnet_b3_alaska2_final.pth) not found."
        print(f"[!] {LOAD_ERROR}")
        return

    try:
        print(f"[*] Loading model from: {weights_path}")
        model = timm.create_model(TIMM_MODEL, pretrained=False, num_classes=NUM_CLASSES)
        checkpoint = torch.load(weights_path, map_location=DEVICE, weights_only=False)

        if isinstance(checkpoint, dict):
            if "model" in checkpoint and isinstance(checkpoint["model"], dict):
                state_dict = checkpoint["model"]
            elif "state_dict" in checkpoint and isinstance(checkpoint["state_dict"], dict):
                state_dict = checkpoint["state_dict"]
            elif "model_state_dict" in checkpoint and isinstance(checkpoint["model_state_dict"], dict):
                state_dict = checkpoint["model_state_dict"]
            elif "net" in checkpoint and isinstance(checkpoint["net"], dict):
                state_dict = checkpoint["net"]
            else:
                state_dict = checkpoint
        else:
            state_dict = checkpoint

        cleaned_state_dict = {}
        for k, v in state_dict.items():
            if isinstance(k, str):
                if k.startswith("module."):
                    k = k[7:]
                if k.startswith("_orig_mod."):
                    k = k[10:]
            cleaned_state_dict[k] = v

        model.load_state_dict(cleaned_state_dict, strict=False)
        MODEL = model.to(DEVICE).eval()
        print("[+] Model loaded successfully!")
    except Exception as e:
        LOAD_ERROR = str(e)
        print(f"[!] Error loading model: {e}")

@app.on_event("startup")
def startup_event():
    load_stego_model()

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------
@app.get("/")
@app.get("/health")
def health_check():
    return {
        "status": "online",
        "model_loaded": MODEL is not None,
        "device": str(DEVICE),
        "error": LOAD_ERROR,
    }

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    if MODEL is None:
        raise HTTPException(status_code=503, detail=f"Model not loaded: {LOAD_ERROR}")

    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File uploaded must be an image.")

    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image file: {e}")

    # Inference
    tensor = TRANSFORM(image).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        logits = MODEL(tensor)
        probs = F.softmax(logits, dim=1)[0].cpu().numpy().tolist()

    p_clean = float(probs[0])
    stego = {label: float(probs[i]) for i, label in enumerate(STEGO_LABELS, start=1)}
    total_threat = sum(stego.values())
    dominant_algo = max(stego, key=lambda k: stego[k])
    dominant_score = stego[dominant_algo]
    is_cover = p_clean > total_threat

    if is_cover:
        headline = "COVER"
        verdict = "COVER (Clean Image)"
        confidence = p_clean
        explanation = (
            f"No steganographic payload detected. {p_clean * 100:.2f}% clean mass, "
            f"strongest steganographic signal is {dominant_algo} at {dominant_score * 100:.2f}%."
        )
    else:
        headline = "STEGO DETECTED"
        verdict = f"STEGO DETECTED ({dominant_algo})"
        confidence = total_threat
        explanation = (
            f"Matches footprint of {dominant_algo} embedding carrying {dominant_score * 100:.2f}% mass. "
            f"Steganographic classes account for {total_threat * 100:.2f}% total."
        )

    return JSONResponse(content={
        "filename": file.filename,
        "is_cover": is_cover,
        "headline": headline,
        "verdict": verdict,
        "explanation": explanation,
        "confidence": confidence,
        "p_clean": p_clean,
        "total_threat": total_threat,
        "dominant_algo": dominant_algo,
        "dominant_score": dominant_score,
        "probs": {label: float(probs[i]) for i, label in enumerate(CLASS_LABELS)},
    })
