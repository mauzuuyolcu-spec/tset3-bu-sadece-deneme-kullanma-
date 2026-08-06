document.addEventListener("DOMContentLoaded", () => {

  const joinScreen = document.getElementById("join-screen");
  const chatScreen = document.getElementById("chat-screen");
  const joinForm = document.getElementById("join-form");
  const usernameInput = document.getElementById("username-input");
  const joinError = document.getElementById("join-error");
  const messagesEl = document.getElementById("messages");
  const messageInput = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");
  const fileBtn = document.getElementById("file-btn");
  const fileInput = document.getElementById("file-input");
  const audioBtn = document.getElementById("audio-btn");
  const recordingIndicator = document.getElementById("recording-indicator");
  const recordingTimer = document.getElementById("recording-timer");
  const cancelRecordingBtn = document.getElementById("cancel-recording-btn");
  const onlineCountEl = document.getElementById("online-count");
  const typingIndicator = document.getElementById("typing-indicator");
  const typingText = document.getElementById("typing-text");
  const userListEl = document.getElementById("user-list");
  const dmInfo = document.getElementById("dm-info");
  const dmTargetName = document.getElementById("dm-target-name");
  const dmCancelBtn = document.getElementById("dm-cancel-btn");
  const adminBtn = document.getElementById("admin-btn");

  let socket = null;
  let myUsername = "";
  let typingTimer = null;
  let dmTarget = null;
  let isAdmin = false;

  // --- Ses kaydı değişkenleri ---
  let mediaRecorder = null;
  let audioChunks = [];
  let recordingStartTime = null;
  let recordingTimerInterval = null;
  let isRecording = false;
  const MAX_RECORDING_DURATION = 60; // saniye

  function getUserColor(name) {
    const colors = ["var(--u1)","var(--u2)","var(--u3)","var(--u4)","var(--u5)","var(--u6)","var(--u7)","var(--u8)"];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  function sendMessage(text, fileData, fileType) {
    if (!socket) return;
    if (!text && !fileData) return;
    const payload = { text };
    if (fileData && fileType === "image") payload.image = fileData;
    if (fileData && fileType === "video") payload.video = fileData;
    if (fileData && fileType === "audio") payload.audio = fileData;
    if (dmTarget) payload.to = dmTarget;
    socket.emit("send_message", payload);
  }

  function renderMessage(msg, isOwn = false) {
    const row = document.createElement("div");
    row.className = `msg-row${isOwn ? " own" : ""}`;
    row.dataset.messageId = msg.id;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.background = getUserColor(msg.username);
    avatar.textContent = msg.username.charAt(0).toUpperCase();
    row.appendChild(avatar);

    const body = document.createElement("div");
    body.className = "msg-body";

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    const nameSpan = document.createElement("span");
    nameSpan.className = "msg-name";
    nameSpan.textContent = msg.username;
    meta.appendChild(nameSpan);
    const timeSpan = document.createElement("span");
    timeSpan.className = "msg-time";
    timeSpan.textContent = msg.time || "";
    meta.appendChild(timeSpan);
    if (msg.is_dm) {
      const dmLabel = document.createElement("span");
      dmLabel.className = "dm-label";
      dmLabel.textContent = "🔒 Özel";
      meta.appendChild(dmLabel);
    }

    if (isAdmin && !msg.is_dm) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "msg-delete-btn";
      deleteBtn.textContent = "🗑️";
      deleteBtn.title = "Mesajı sil";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm("Bu mesajı silmek istediğine emin misin?")) {
          socket.emit("delete_message", { message_id: msg.id });
        }
      });
      meta.appendChild(deleteBtn);
    }

    body.appendChild(meta);

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    if (msg.text) {
      const textNode = document.createTextNode(msg.text);
      bubble.appendChild(textNode);
    }
    if (msg.image) {
      const img = document.createElement("img");
      img.className = "msg-image";
      img.src = msg.image;
      img.alt = "Resim";
      img.loading = "lazy";
      img.addEventListener("click", () => window.open(msg.image, "_blank"));
      bubble.appendChild(img);
    }
    if (msg.video) {
      const video = document.createElement("video");
      video.className = "msg-video";
      video.src = msg.video;
      video.controls = true;
      video.preload = "metadata";
      bubble.appendChild(video);
    }
    if (msg.audio) {
      const audio = document.createElement("audio");
      audio.className = "msg-audio";
      audio.src = msg.audio;
      audio.controls = true;
      audio.preload = "metadata";
      bubble.appendChild(audio);
    }

    body.appendChild(bubble);
    row.appendChild(body);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function removeMessageFromDOM(messageId) {
    const msgElement = document.querySelector(`.msg-row[data-message-id="${messageId}"]`);
    if (msgElement) {
      msgElement.remove();
    }
  }

  function renderSystemMessage(text) {
    const div = document.createElement("div");
    div.className = "system-msg";
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function updateOnlineCount(count) {
    onlineCountEl.textContent = `${count} çevrimiçi`;
  }

  function updateUserList(users) {
    userListEl.innerHTML = "";
    users.forEach(username => {
      const li = document.createElement("li");
      li.className = "user-item";

      const avatar = document.createElement("span");
      avatar.className = "user-avatar";
      avatar.style.background = getUserColor(username);
      avatar.textContent = username.charAt(0).toUpperCase();
      li.appendChild(avatar);

      const nameSpan = document.createElement("span");
      nameSpan.className = "user-name";
      nameSpan.textContent = username;
      li.appendChild(nameSpan);

      if (username !== myUsername) {
        const dmBtn = document.createElement("button");
        dmBtn.className = "user-dm-btn";
        dmBtn.textContent = "💬";
        dmBtn.title = "Özel mesaj gönder";
        dmBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          startDM(username);
        });
        li.appendChild(dmBtn);

        if (isAdmin) {
          const banBtn = document.createElement("button");
          banBtn.className = "user-ban-btn";
          banBtn.textContent = "🚫";
          banBtn.title = "Bu kullanıcıyı banla (1 saat)";
          banBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (confirm(`${username} kullanıcısını 1 saatliğine banlamak istediğine emin misin?`)) {
              socket.emit("ban_user", { username });
            }
          });
          li.appendChild(banBtn);
        }
      } else {
        const meSpan = document.createElement("span");
        meSpan.className = "user-me";
        meSpan.textContent = "(sen)";
        li.appendChild(meSpan);
      }

      userListEl.appendChild(li);
    });
  }

  function startDM(username) {
    dmTarget = username;
    dmTargetName.textContent = username;
    dmInfo.classList.remove("hidden");
    messageInput.placeholder = `@${username} için özel mesaj...`;
    messageInput.focus();
  }

  function cancelDM() {
    dmTarget = null;
    dmInfo.classList.add("hidden");
    messageInput.placeholder = "Mesaj yaz, dosya ekle...";
  }

  adminBtn.addEventListener("click", () => {
    if (isAdmin) {
      renderSystemMessage("✅ Zaten admin yetkisine sahipsiniz.");
      return;
    }
    const code = prompt("Admin kodunu girin:");
    if (code === null) return;
    if (code.trim() === "") {
      renderSystemMessage("❌ Kod boş olamaz.");
      return;
    }
    socket.emit("admin_auth", { code: code.trim() });
  });

  // --- SES KAYDI ---
  async function startRecording() {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];

      mediaRecorder.ondataavailable = event => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => {
          const base64data = reader.result;
          sendMessage("", base64data, "audio");
          // Temizlik
          stream.getTracks().forEach(track => track.stop());
        };
        reader.readAsDataURL(audioBlob);
        // UI temizle
        stopRecordingUI();
      };

      mediaRecorder.start();
      isRecording = true;
      recordingStartTime = Date.now();
      recordingTimer.textContent = "0s";
      recordingIndicator.classList.remove("hidden");
      audioBtn.classList.add("recording");
      audioBtn.title = "Kaydediliyor...";

      // Timer güncelle
      recordingTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        recordingTimer.textContent = `${elapsed}s`;
        if (elapsed >= MAX_RECORDING_DURATION) {
          stopRecording();
        }
      }, 500);
    } catch (err) {
      console.error("Mikrofon erişimi hatası:", err);
      renderSystemMessage("❌ Mikrofon erişilemedi. Lütfen izin verin.");
    }
  }

  function stopRecording() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      isRecording = false;
      clearInterval(recordingTimerInterval);
    }
  }

  function stopRecordingUI() {
    isRecording = false;
    recordingIndicator.classList.add("hidden");
    audioBtn.classList.remove("recording");
    audioBtn.title = "Sesli mesaj (maks 60 sn)";
    clearInterval(recordingTimerInterval);
  }

  function cancelRecording() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.onstop = () => {
        // Kaydı iptal et, gönderme
        stopRecordingUI();
        // stream'i durdur
        if (mediaRecorder.stream) {
          mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
      };
      mediaRecorder.stop();
    } else {
      stopRecordingUI();
    }
  }

  audioBtn.addEventListener("click", startRecording);
  cancelRecordingBtn.addEventListener("click", cancelRecording);

  // --- JOIN ---
  joinForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    if (!username) {
      joinError.textContent = "Lütfen bir kullanıcı adı girin.";
      joinError.classList.remove("hidden");
      return;
    }
    joinError.classList.add("hidden");

    socket = io({
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });

    socket.on("connect", () => {
      socket.emit("join", { username });
    });

    socket.on("join_error", (data) => {
      joinError.textContent = data.message;
      joinError.classList.remove("hidden");
      socket.disconnect();
    });

    socket.on("joined", (data) => {
      myUsername = data.username;
      if (data.history) data.history.forEach(msg => renderMessage(msg, msg.username === myUsername));
      updateOnlineCount(data.online_count);
      joinScreen.classList.add("hidden");
      chatScreen.classList.remove("hidden");
      messageInput.focus();
    });

    socket.on("user_joined", (data) => {
      renderSystemMessage(`📡 ${data.username} yayına katıldı.`);
      updateOnlineCount(data.online_count);
    });

    socket.on("user_left", (data) => {
      renderSystemMessage(`🔇 ${data.username} yayından ayrıldı.`);
      updateOnlineCount(data.online_count);
    });

    socket.on("user_list", (data) => {
      updateOnlineCount(data.users.length);
      updateUserList(data.users);
    });

    socket.on("new_message", (msg) => {
      const isOwn = (msg.username === myUsername);
      renderMessage(msg, isOwn);
    });

    socket.on("user_typing", (data) => {
      if (data.username !== myUsername) {
        typingText.textContent = `${data.username} yazıyor...`;
        typingIndicator.classList.remove("hidden");
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => typingIndicator.classList.add("hidden"), 3000);
      }
    });

    socket.on("user_stop_typing", () => {
      typingIndicator.classList.add("hidden");
    });

    socket.on("admin_approved", (data) => {
      if (data.status) {
        isAdmin = true;
        adminBtn.classList.add("active");
        renderSystemMessage("✅ Admin yetkisi alındı! Artık kullanıcıları banlayabilir ve mesajları silebilirsiniz.");
        // Mevcut mesajlara silme butonlarını ekle (kolay yol: sayfayı yenile uyarısı)
        renderSystemMessage("🔄 Değişikliklerin tamamen görünmesi için sayfayı yenileyin (F5).");
      } else {
        renderSystemMessage(`❌ ${data.message || "Geçersiz kod."}`);
      }
    });

    socket.on("message_deleted", (data) => {
      removeMessageFromDOM(data.message_id);
      renderSystemMessage("🗑️ Bir mesaj silindi.");
    });

    socket.on("disconnect", () => {
      renderSystemMessage("⚠️ Bağlantı kesildi, yeniden bağlanmaya çalışılıyor...");
    });

    socket.on("reconnect", (attempt) => {
      renderSystemMessage(`✅ Bağlantı yeniden kuruldu (deneme ${attempt}).`);
    });

    socket.on("reconnect_error", (err) => {
      renderSystemMessage(`⚠️ Yeniden bağlanma hatası: ${err.message}`);
    });

    socket.on("reconnect_failed", () => {
      renderSystemMessage("❌ Yeniden bağlanma başarısız, sayfayı yenileyin.");
    });
  });

  // --- MESAJ GÖNDERME (metin + dosya) ---
  function handleSend() {
    const text = messageInput.value.trim();
    let fileData = null;
    let fileType = null;

    if (fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const reader = new FileReader();
      reader.onload = function(e) {
        fileData = e.target.result;
        if (file.type.startsWith("image/")) fileType = "image";
        else if (file.type.startsWith("video/")) fileType = "video";
        else {
          alert("Sadece resim veya video dosyası seçin.");
          fileInput.value = "";
          return;
        }
        sendMessage(text, fileData, fileType);
        messageInput.value = "";
        fileInput.value = "";
        cancelDM();
      };
      reader.readAsDataURL(file);
      return;
    }

    sendMessage(text, null, null);
    messageInput.value = "";
    fileInput.value = "";
    cancelDM();
  }

  sendBtn.addEventListener("click", handleSend);
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  let typingTimeout = null;
  messageInput.addEventListener("input", () => {
    if (socket && myUsername) {
      socket.emit("typing");
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => socket.emit("stop_typing"), 1000);
    }
  });

  fileBtn.addEventListener("click", () => fileInput.click());
  dmCancelBtn.addEventListener("click", cancelDM);

  console.log("Frekans video, ban, DM, mesaj silme ve SESLİ MESAJ sistemi aktif!");
});
