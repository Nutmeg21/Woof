from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from scam_model import JamScamDetector
import uvicorn

app = FastAPI()

# Allow connections from the app (Cross-Origin Resource Sharing)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the AI
detector = JamScamDetector()

@app.get("/")
def home():
    return {"message": "Scam Guard Backend is Running"}

@app.websocket("/ws/audio")
async def audio_stream(websocket: WebSocket):
    await websocket.accept()
    print("Client connected")
    
    try:
        while True:
            # 1. Receive Audio Chunk from App
            audio_data = await websocket.receive_bytes()
            
            # 2. Process with JAM AI
            result = detector.predict(audio_data)
            
            # 3. Send Result back to App
            await websocket.send_json(result)
            
    except Exception as e:
        print(f"Connection closed: {e}")
    finally:
        await websocket.close()

if __name__ == "__main__":
    # 0.0.0.0 allows your phone to connect to your laptop
    uvicorn.run(app, host="0.0.0.0", port=8000)