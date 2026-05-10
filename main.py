from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from scam_model import JamScamDetector
from email_reader import EmailReader
import uvicorn
import json
import base64
import os
from dotenv import load_dotenv
import asyncio # <-- NEW IMPORT

load_dotenv()
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

detector = JamScamDetector()

# NEW: Keep a list of phones currently connected to the app
active_clients = []

# --- NEW: THE AUTOPILOT BACKGROUND LOOP ---
async def background_email_scanner():
    """This runs 24/7 on the server, even if the app is closed."""
    print("🤖 Autopilot Email Scanner Started...")
    
    email_user = os.getenv("EMAIL_USER")
    email_pass = os.getenv("EMAIL_PASS")
    
    if not email_user or not email_pass:
        print("❌ Autopilot Offline: Missing .env credentials.")
        return

    reader = EmailReader(email_user, email_pass)

    while True:
        try:
            print("⏳ Autopilot: Checking inbox for new threats/bills...")
            emails = reader.fetch_bill_emails(limit=2) # Only check the latest 2 to save time
            
            if emails:
                for content in emails:
                    # Run it through the JamAI gatekeeper
                    result = detector.analyze_email_and_budget(content)
                    
                    # If phones are connected, broadcast the alert/bill instantly!
                    if active_clients:
                        for client in active_clients:
                            try:
                                await client.send_json(result)
                            except Exception:
                                active_clients.remove(client)
                    else:
                        # If the app is closed, it still logs the threat!
                        print(f"🔒 App is closed, but backend caught: {result['status']} - {result.get('merchant', 'Unknown')}")
            
        except Exception as e:
            print(f"Autopilot Error: {e}")
            
        # VERY IMPORTANT: Wait 60 seconds before checking again! 
        # If you don't pause, Gmail will ban your IP address for spamming their server.
        await asyncio.sleep(60) 
# ------------------------------------------

@app.on_event("startup")
async def startup_event():
    # Start the autopilot loop the moment the server turns on
    asyncio.create_task(background_email_scanner())

@app.get("/")
def home():
    return {"message": "Scam Guard Backend is Running"}

@app.websocket("/ws/audio")
async def audio_stream(websocket: WebSocket):
    await websocket.accept()
    active_clients.append(websocket) # Add phone to the broadcast list
    print("Client connected - Ready to process data")
    
    try:
        while True:
            data_text = await websocket.receive_text()
            data_json = json.loads(data_text)
            message_type = data_json.get("type")

            # Your existing audio/text handling stays exactly the same...
            if message_type == "audio_chunk":
                audio_bytes = base64.b64decode(data_json["data"])
                result = detector.predict(audio_bytes)
                await websocket.send_json(result)

            elif message_type == "text_message":
                text_content = data_json["data"]
                result = detector.predict_text(text_content)
                await websocket.send_json(result)

            # Note: We can remove the "sync_emails" block because the server 
            # is now doing it automatically in the background!
            
    except WebSocketDisconnect:
        active_clients.remove(websocket) # Remove phone when app closes
        print("Client disconnected")
    except Exception as e:
        print(f"Error: {e}")
        if websocket in active_clients:
            active_clients.remove(websocket)
    finally:
        try:
            await websocket.close()
        except:
            pass

if __name__ == "__main__":
    uvicorn.run(app, host="10.171.71.71", port=8081) # Use your IP