from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from scam_model import JamScamDetector
import uvicorn
import json
import base64

app = FastAPI()

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
    print("Client connected - Ready to process audio")
    
    try:
        while True:
            # 1. Receive JSON Text (contains Base64 audio)
            data_text = await websocket.receive_text()
            data_json = json.loads(data_text)
            
            if data_json.get("type") == "audio_chunk":
                # 2. Decode Base64 back to Audio Bytes
                # This is the actual file content (like a .m4a file in memory)
                audio_bytes = base64.b64decode(data_json["data"])
                
                # 3. Process with JAM AI
                result = detector.predict(audio_bytes)
                
                # 4. Send Result back to App
                await websocket.send_json(result)
            
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        try:
            await websocket.close()
        except:
            pass

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)