import os
import time
import uuid
import re
import assemblyai as aai
from jamaibase import JamAI, protocol as p
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

class JamScamDetector:
    def __init__(self):
        print("Initializing Scam Detector (AssemblyAI + JamAI)...")
        
        self.jamai_project_id = os.getenv("JAMAI_PROJECT_ID", "")
        self.jamai_api_key = os.getenv("JAMAI_API_KEY", "")
        self.assembly_api_key = os.getenv("ASSEMBLYAI_API_KEY", "")
        self.table_id = "scam_detection" 

        try:
            self.jam_client = JamAI(project_id=self.jamai_project_id, token=self.jamai_api_key)
            print("✅ JamAI Connected")
        except Exception as e:
            print(f"❌ JamAI Error: {e}")

        aai.settings.api_key = self.assembly_api_key
        self.transcriber = aai.Transcriber()

        base_dir = os.path.dirname(os.path.abspath(__file__))
        self.recordings_dir = os.path.join(base_dir, "recordings")
        if not os.path.exists(self.recordings_dir): os.makedirs(self.recordings_dir)
        self.file_toggle = 0

    def transcribe_audio(self, file_path: str) -> str:
        print(f"  - Transcribing {os.path.basename(file_path)}...")
        config = aai.TranscriptionConfig(speaker_labels=True, speakers_expected=2)
        try:
            transcript = self.transcriber.transcribe(file_path, config=config)
        except Exception as e:
            print(f"  ⚠️ AssemblyAI Failed: {e}")
            raise e
        
        if transcript.status == aai.TranscriptStatus.error:
            raise Exception(f"Transcription Error: {transcript.error}")

        dialogue = []
        for utterance in transcript.utterances:
            dialogue.append(f"Speaker {utterance.speaker}: {utterance.text}")
        return "\n".join(dialogue)

    def predict(self, audio_data: bytes) -> dict:
        self.file_toggle = 1 - self.file_toggle
        filename = f"live_buffer_{self.file_toggle}.m4a"
        file_path = os.path.join(self.recordings_dir, filename)
        
        try:
            with open(file_path, "wb") as f:
                f.write(audio_data)
            
            try:
                conversation_text = self.transcribe_audio(file_path)
            except Exception:
                return {"status": "SAFE", "message": "Listening...", "color": "#10b981"}
            
            if not conversation_text.strip():
                return {"status": "SAFE", "message": "Listening (No speech)...", "color": "#10b981"}

            print(f"📝 Transcript: {conversation_text[:50]}...")

            completion = self.jam_client.table.add_table_rows(
                table_type="action", 
                request=p.RowAddRequest(
                    table_id=self.table_id,
                    data=[{"input": conversation_text}],
                    stream=False
                )
            )

            if completion.rows:
                cols = completion.rows[0].columns
                
                print("\n🔍 --- DEBUGGING COLUMN IDs ---")
                found_score = None
                found_analysis = ""
                
                for col_id, col_data in cols.items():
                    # Print every column ID and its text content
                    print(f"   ID: '{col_id}'  | Value: '{col_data.text}'")
                    
                    # Auto-detect score column if it contains "Spam Score" or "%"
                    if "spam" in col_id.lower() or "%" in str(col_data.text):
                        found_score = col_data.text
                    
                    # Auto-detect analysis column
                    if "result" in col_id.lower() or "analysis" in col_id.lower():
                        found_analysis = col_data.text
                
                print("-------------------------------\n")

                # Use the found data (or fallback to empty string)
                score_raw = found_score if found_score else "0"
                analysis_text = found_analysis if found_analysis else ""

                confidence = 0.0
                score_match = re.search(r"(\d+)(?=%)|(\d+)", score_raw)
                
                if score_match:
                    val = float(score_match.group(1) or score_match.group(2))
                    confidence = val / 100.0

                if confidence == 0.0:
                    if "high risk" in score_raw.lower() or "95" in score_raw: confidence = 0.95
                    elif "medium risk" in score_raw.lower(): confidence = 0.60

                if confidence >= 0.80: 
                    return {"status": "SCAM", "message": f"⚠️ High Risk! ({int(confidence*100)}%)", "color": "#ef4444", "confidence": confidence * 100}
                elif confidence >= 0.50: 
                    return {"status": "SUSPICIOUS", "message": f"Medium Risk ({int(confidence*100)}%)", "color": "#FE9301", "confidence": confidence * 100}
                else:
                    return {"status": "SAFE", "message": f"Low Risk ({int(confidence*100)}%)", "color": "#10b981", "confidence": confidence * 100}

            return {"status": "SAFE", "message": "Analyzing...", "color": "#10b981"}

        except Exception as e:
            print(f"Error: {e}")
            return {"status": "SAFE", "message": "Listening...", "color": "#10b981"}
               
    def predict_text(self, text_content: str) -> dict:
        try:
            print(f"📩 Analyzing Text: {text_content[:30]}...")
            if not self.jam_client: return {"status": "ERROR", "message": "AI Offline"}

            completion = self.jam_client.table.add_table_rows(
                table_type="action",
                request=p.RowAddRequest(
                    table_id=self.table_id,
                    data=[{"input": text_content}],
                    stream=False
                )
            )

            if completion.rows:
                cols = completion.rows[0].columns
                score_raw = cols["spam_score"].text if "spam_score" in cols else "0"
                
                confidence = 0.0
                score_match = re.search(r"(\d+)", score_raw)
                if score_match:
                    val = float(score_match.group(1))
                    confidence = val / 100.0 if val > 1.0 else val

                if confidence > 0.7:
                     return {"status": "SCAM", "message": "⚠️ Scam SMS Detected!", "color": "#ef4444"}
                
                return {"status": "SAFE", "message": "Message looks safe.", "color": "#10b981"}
            
            return {"status": "SAFE", "message": "Analysis failed.", "color": "gray"}
        except Exception as e:
            print(f"Text Error: {e}")
            return {"status": "SAFE", "message": "Error.", "color": "gray"}

if __name__ == "__main__":
    detector = JamScamDetector()
    test_file = os.path.join(detector.recordings_dir, "test.m4a")
    if os.path.exists(test_file):
        print(f"Testing with {test_file}...")
        with open(test_file, "rb") as f:
            audio_bytes = f.read()
        result = detector.predict(audio_bytes)
        print(f"RESULT: {result}")
    else:
        print(f"To test, place a file named 'test.m4a' in: {detector.recordings_dir}")
