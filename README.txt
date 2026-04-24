LAYLA NIGHTS — CLUB MODE

No Stripe. No online payment.

Included:
- Landing page with premium wording: “Accéder à l’expérience”, “Demander accès VIP”
- Private access request form
- WhatsApp pre-filled contact button
- Admin dashboard to approve/reject guests
- QR code generated for approved guests
- Scan page to validate tickets at entrance

Local setup:
1. Install Node.js
2. Open this folder in terminal
3. Run: npm install
4. Copy .env.example to .env
5. Edit ADMIN_PASSWORD and WHATSAPP_NUMBER
6. Run: npm start
7. Open: http://localhost:4242

Admin dashboard:
http://localhost:4242/admin.html

Scanner page:
http://localhost:4242/scan.html

Deployment:
You can deploy this on Render as a Node web service.
Set environment variables on Render:
- APP_URL = your public site URL
- ADMIN_PASSWORD = your private admin password
- WHATSAPP_NUMBER = your WhatsApp number with country code, without +

Important:
This version stores guests in a local file named guests.db.
On free Render, filesystem storage is not guaranteed long term.
For a real event, move storage to Postgres/Supabase/Google Sheets.
