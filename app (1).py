"""
Frekans - Video & Resim Paylaşımlı, Ban Sistemi, Özel Mesaj (DM), Mesaj Silme (Admin)
Admin yetkisi: 7777 kodu ile etkinleştirilir.
"""

import os
import random
import time
import uuid
from datetime import datetime, timedelta

from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config["SECRET_KEY"] = "bu-anahtari-degistir"

socketio = SocketIO(app, cors_allowed_origins="*")

# --- Bellekteki veriler ---
connected_users = {}        # { sid: {"username": str, "admin": bool} }
message_history = []        # son 50 mesaj, her mesajda "id" alanı var
banned_users = {}           # { username: ban_bitis_zamani (timestamp) }

MAX_HISTORY = 50
MAX_IMAGE_SIZE = 25 * 1024 * 1024   # 25 MB
MAX_VIDEO_SIZE = 20 * 1024 * 1024   # 20 MB
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/webm", "video/ogg"}

BAN_DURATION = 3600  # 1 saat (saniye)
ADMIN_CODE = "7777"

def online_count():
    return len(connected_users)

def is_banned(username):
    if username in banned_users:
        if time.time() < banned_users[username]:
            return True
        else:
            del banned_users[username]
    return False

@app.route("/")
def index():
    return render_template("index.html")

# --- Socket.IO ---
@socketio.on("connect")
def handle_connect():
    print(f"Yeni baglanti: {request.sid}")

@socketio.on("disconnect")
def handle_disconnect():
    user_data = connected_users.pop(request.sid, None)
    if user_data:
        username = user_data["username"]
        emit("user_left", {"username": username, "online_count": online_count()}, broadcast=True)
        user_list = [u["username"] for u in connected_users.values()]
        emit("user_list", {"users": user_list}, broadcast=True)

@socketio.on("join")
def handle_join(data):
    username = (data or {}).get("username", "").strip()[:20]
    if not username:
        username = f"Misafir{random.randint(1000, 9999)}"

    if is_banned(username):
        emit("join_error", {"message": "Bu kullanıcı 1 saatliğine yasaklanmıştır."})
        return

    existing = {u["username"] for u in connected_users.values()}
    original, n = username, 2
    while username in existing:
        username = f"{original}{n}"
        n += 1

    connected_users[request.sid] = {"username": username, "admin": False}

    emit("joined", {
        "username": username,
        "history": message_history,
        "online_count": online_count(),
    })

    emit("user_joined", {
        "username": username,
        "online_count": online_count(),
    }, broadcast=True, include_self=False)

    user_list = [u["username"] for u in connected_users.values()]
    emit("user_list", {"users": user_list}, broadcast=True)

# --- Admin doğrulama ---
@socketio.on("admin_auth")
def handle_admin_auth(data):
    code = (data or {}).get("code", "").strip()
    if code == ADMIN_CODE:
        if request.sid in connected_users:
            connected_users[request.sid]["admin"] = True
            emit("admin_approved", {"status": True})
    else:
        emit("admin_approved", {"status": False, "message": "Geçersiz kod."})

# --- BAN OLAYI (sadece admin) ---
@socketio.on("ban_user")
def handle_ban_user(data):
    admin_data = connected_users.get(request.sid)
    if not admin_data or not admin_data.get("admin", False):
        emit("new_message", {
            "username": "Sistem",
            "text": "❌ Bu işlem için admin yetkisi gerekir.",
            "time": datetime.now().strftime("%H:%M")
        })
        return

    target = (data or {}).get("username", "").strip()
    if not target:
        return

    admin_username = admin_data["username"]

    if target == admin_username:
        emit("new_message", {
            "username": "Sistem",
            "text": "❌ Kendini banlayamazsın.",
            "time": datetime.now().strftime("%H:%M")
        })
        return

    target_sid = None
    for sid, ud in connected_users.items():
        if ud["username"] == target:
            target_sid = sid
            break
    if not target_sid:
        emit("new_message", {
            "username": "Sistem",
            "text": f"❌ {target} çevrimiçi değil.",
            "time": datetime.now().strftime("%H:%M")
        })
        return

    banned_users[target] = time.time() + BAN_DURATION

    emit("new_message", {
        "username": "Sistem",
        "text": f"🚫 {target} 1 saatliğine banlandı.",
        "time": datetime.now().strftime("%H:%M")
    }, broadcast=True)

    connected_users.pop(target_sid, None)
    emit("user_left", {"username": target, "online_count": online_count()}, broadcast=True)

    user_list = [u["username"] for u in connected_users.values()]
    emit("user_list", {"users": user_list}, broadcast=True)

# --- MESAJ GÖNDERME (DM desteği + id) ---
@socketio.on("send_message")
def handle_send_message(data):
    sender_data = connected_users.get(request.sid)
    if not sender_data:
        return
    sender = sender_data["username"]

    if is_banned(sender):
        emit("new_message", {
            "username": "Sistem",
            "text": "❌ Bu hesap 1 saatliğine banlanmıştır.",
            "time": datetime.now().strftime("%H:%M")
        })
        return

    text = (data or {}).get("text", "").strip()[:500]
    image_data = (data or {}).get("image", "").strip()
    video_data = (data or {}).get("video", "").strip()
    to_user = (data or {}).get("to", "").strip()

    if not text and not image_data and not video_data:
        return

    if image_data:
        try:
            header, encoded = image_data.split(",", 1)
            mime_type = header.split(":")[1].split(";")[0]
            if mime_type not in ALLOWED_IMAGE_TYPES or len(encoded) > MAX_IMAGE_SIZE * 4 / 3:
                return
        except:
            return

    if video_data:
        try:
            header, encoded = video_data.split(",", 1)
            mime_type = header.split(":")[1].split(";")[0]
            if mime_type not in ALLOWED_VIDEO_TYPES or len(encoded) > MAX_VIDEO_SIZE * 4 / 3:
                return
        except:
            return

    message = {
        "id": str(uuid.uuid4()),
        "username": sender,
        "text": text,
        "time": datetime.now().strftime("%H:%M"),
        "is_dm": False
    }
    if image_data:
        message["image"] = image_data
    if video_data:
        message["video"] = video_data

    # Özel mesaj mı?
    if to_user and to_user in {u["username"] for u in connected_users.values()}:
        message["is_dm"] = True
        message["to"] = to_user
        recipient_sid = None
        for sid, ud in connected_users.items():
            if ud["username"] == to_user:
                recipient_sid = sid
                break
        if recipient_sid:
            emit("new_message", message, room=request.sid)
            emit("new_message", message, room=recipient_sid)
            message_history.append(message)
            if len(message_history) > MAX_HISTORY:
                message_history.pop(0)
            return

    # Herkese açık mesaj
    message_history.append(message)
    if len(message_history) > MAX_HISTORY:
        message_history.pop(0)
    emit("new_message", message, broadcast=True)

# --- MESAJ SİLME (sadece admin) ---
@socketio.on("delete_message")
def handle_delete_message(data):
    admin_data = connected_users.get(request.sid)
    if not admin_data or not admin_data.get("admin", False):
        emit("new_message", {
            "username": "Sistem",
            "text": "❌ Bu işlem için admin yetkisi gerekir.",
            "time": datetime.now().strftime("%H:%M")
        })
        return

    msg_id = data.get("message_id")
    if msg_id is None:
        return

    global message_history
    for idx, msg in enumerate(message_history):
        if msg.get("id") == msg_id:
            if msg.get("is_dm", False):
                emit("new_message", {
                    "username": "Sistem",
                    "text": "❌ Özel mesajlar silinemez.",
                    "time": datetime.now().strftime("%H:%M")
                })
                return
            message_history.pop(idx)
            emit("message_deleted", {"message_id": msg_id}, broadcast=True)
            return

    emit("new_message", {
        "username": "Sistem",
        "text": "❌ Mesaj bulunamadı veya zaten silinmiş.",
        "time": datetime.now().strftime("%H:%M")
    })

# --- TYPING ---
@socketio.on("typing")
def handle_typing(_data):
    user_data = connected_users.get(request.sid)
    if user_data and not is_banned(user_data["username"]):
        emit("user_typing", {"username": user_data["username"]}, broadcast=True, include_self=False)

@socketio.on("stop_typing")
def handle_stop_typing(_data):
    user_data = connected_users.get(request.sid)
    if user_data:
        emit("user_stop_typing", {"username": user_data["username"]}, broadcast=True, include_self=False)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, debug=False, host="0.0.0.0", port=port)
