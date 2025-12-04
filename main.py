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
    print("Client connected - Ready to process data")
    
    try:
        while True:
            data_text = await websocket.receive_text()
            data_json = json.loads(data_text)
            
            message_type = data_json.get("type")

            if message_type == "audio_chunk":
                # Decode Base64 back to Audio Bytes
                audio_bytes = base64.b64decode(data_json["data"])
                
                # Process with JAM AI (Audio)
                result = detector.predict(audio_bytes)
                
                # Send Result back to App
                await websocket.send_json(result)

            elif message_type == "text_message":
                text_content = data_json["data"]
                print(f"Received Text: {text_content}")
                
                result = detector.predict_text(text_content)
                
                # Send Result back to App
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