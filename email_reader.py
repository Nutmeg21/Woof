import imaplib
import email
from email.header import decode_header
import re

class EmailReader:
    def __init__(self, user_email, password):
        # FIX: Ensure these are strings with quotes
        self.user = user_email
        self.password = password
        self.server = "imap.gmail.com"

    def fetch_bill_emails(self, limit=5):
        try:
            print(f"📡 Connecting to {self.server}...")
            mail = imaplib.IMAP4_SSL(self.server)
            
            print(f"🔑 Attempting login for {self.user}...")
            mail.login(self.user, self.password)
            print("✅ Login Successful!")

            mail.select("inbox")

            # Search for common Malaysian bill keywords
            print("🔍 Searching for subscription emails...")
            search_query = '(OR SUBJECT "Receipt" (OR SUBJECT "Payment" (OR SUBJECT "Invoice" SUBJECT "Bill")))'
            status, messages = mail.search(None, search_query)
            
            email_ids = messages[0].split()
            print(f"📩 Found {len(email_ids)} matching emails.")
            
            extracted_contents = []

            # Fetch the most recent emails
            for i in range(len(email_ids)-1, len(email_ids)-1-limit, -1):
                if i < 0: break
                
                print(f"📦 Fetching email index: {i}...")
                res, msg_data = mail.fetch(email_ids[i], "(RFC822)")
                for response_part in msg_data:
                    if isinstance(response_part, tuple):
                        msg = email.message_from_bytes(response_part[1])
                        
                        # Get Body Content
                        body = ""
                        if msg.is_multipart():
                            for part in msg.walk():
                                if part.get_content_type() == "text/plain":
                                    body = part.get_payload(decode=True).decode()
                        else:
                            body = msg.get_payload(decode=True).decode()
                        
                        extracted_contents.append(body)

            print(f"🏁 Successfully extracted {len(extracted_contents)} email bodies.")
            mail.logout()
            return extracted_contents

        except Exception as e:
            print(f"❌ Mail Error: {e}")
            return []