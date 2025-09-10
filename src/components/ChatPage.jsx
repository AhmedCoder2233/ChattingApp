import React, { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Send, Paperclip, Edit2, Trash2, Check, X, User, Circle } from "lucide-react";

const API_URL = "https://huggingface.co/spaces/AhmedKing241/Backend";
const WS_URL = "ws://huggingface.co/spaces/AhmedKing241/Backend/ws";

// Simple debounce utility to prevent rapid API calls
const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

const ChatPage = () => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editText, setEditText] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("disconnected");
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  const ws = useRef(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttempts = useRef(0);

  // UUID validation regex
  const isValidUUID = (id) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return typeof id === "string" && uuidRegex.test(id);
  };

  // Generate unique key for messages
  const generateMessageKey = (msg) => {
    return `${msg.message_id || msg.temp_id}-${msg.sender_id}-${msg.receiver_id}-${msg.created_at}`;
  };

  // Auto scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // Fetch current user
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      console.error("No token found in localStorage");
      setError("No authentication token found. Please log in.");
      navigate("/");
      return;
    }

    console.log("Fetching current user with token:", token.slice(0, 10) + "...");
    axios
      .get(`${API_URL}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        console.log("Current user response:", res.data);
        const user = res.data;
        if (!user || typeof user !== "object" || !isValidUUID(user.id)) {
          console.error("Invalid user response or ID:", user);
          setError("Invalid user data received. Please log in again.");
          localStorage.removeItem("token");
          navigate("/");
          return;
        }
        console.log("Valid user ID:", user.id);
        setCurrentUser(user);
        console.log("Set currentUser:", user);
      })
      .catch((err) => {
        console.error("Error fetching current user:", err.response?.data || err.message);
        setError(err.response?.data?.detail || "Failed to load user data. Please log in again.");
        localStorage.removeItem("token");
        navigate("/");
      });
  }, [navigate]);

  // Fetch users list
  useEffect(() => {
    if (!currentUser) return;

    const fetchUsers = () => {
      const token = localStorage.getItem("token");
      if (!token) {
        console.error("Token missing during users fetch");
        setError("Session expired. Please log in again.");
        navigate("/");
        return;
      }
      axios
        .get(`${API_URL}/users`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        .then((res) => {
          const fetchedUsers = res.data.filter((user) => isValidUUID(user.id));
          console.log("Users fetched:", fetchedUsers);
          setUsers(fetchedUsers);
        })
        .catch((err) => {
          console.error("Error fetching users:", err.response?.data || err.message);
          if (err.response?.status === 401) {
            setError("Session expired. Please log in again.");
            localStorage.removeItem("token");
            navigate("/");
          } else {
            setError("Failed to load users. Please try again.");
          }
        });
    };

    fetchUsers();
    const interval = setInterval(fetchUsers, 30000);
    return () => clearInterval(interval);
  }, [currentUser, navigate]);

  // Fetch chat history
  const fetchMessages = useCallback(
    debounce(async () => {
      if (!selectedUser || !currentUser) {
        console.log("Skipping fetchMessages: missing selectedUser or currentUser");
        return;
      }

      if (!isValidUUID(currentUser.id) || !isValidUUID(selectedUser.id)) {
        console.error("Invalid UUIDs detected:", {
          currentUserId: currentUser.id,
          selectedUserId: selectedUser.id,
        });
        setError("Invalid user IDs. Please log out and log in again.");
        return;
      }

      console.log("Fetching messages for:", {
        currentUserId: currentUser.id,
        selectedUserId: selectedUser.id,
      });
      const token = localStorage.getItem("token");
      try {
        const res = await axios.get(
          `${API_URL}/messages/${currentUser.id}/${selectedUser.id}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        console.log("Messages fetched:", res.data);
        setMessages(res.data.map((msg) => ({
          ...msg,
          key: generateMessageKey(msg),
        })));
        setRetryCount(0);
      } catch (error) {
        console.error("Error fetching messages:", error.response?.data || error.message);
        if (error.response?.status === 401) {
          setError("Session expired. Please log in again.");
          localStorage.removeItem("token");
          navigate("/");
        } else if (error.response?.status === 403) {
          console.error("403 Access denied for IDs:", {
            currentUserId: currentUser.id,
            selectedUserId: selectedUser.id,
          });
          setError("Access denied. Please log out and log in again.");
          localStorage.removeItem("token");
          navigate("/");
        } else if (error.response?.status === 404) {
          setError("One or both users not found. Please select a valid user.");
        } else {
          setError("Failed to load messages. Please try again.");
        }
      }
    }, 500),
    [currentUser, selectedUser, navigate]
  );

  // Load chat history on initial selectedUser change and periodically when WebSocket is disconnected
  useEffect(() => {
    if (selectedUser && currentUser) {
      fetchMessages();
      // Periodic polling when WebSocket is disconnected
      const interval = setInterval(() => {
        if (ws.current?.readyState !== WebSocket.OPEN) {
          console.log("WebSocket disconnected, polling messages...");
          fetchMessages();
        }
      }, 5000); // Poll every 5 seconds
      return () => clearInterval(interval);
    }
  }, [selectedUser, currentUser, fetchMessages]);

  // WebSocket connection with improved reconnection logic
  const connectWebSocket = useCallback(() => {
    if (!currentUser || ws.current?.readyState === WebSocket.OPEN) {
      console.log("Skipping WebSocket connection: already open or no currentUser");
      return;
    }

    try {
      console.log("Initiating WebSocket connection to:", WS_URL);
      ws.current = new WebSocket(WS_URL);

      ws.current.onopen = () => {
        console.log("WebSocket connected successfully");
        setConnectionStatus("connected");
        reconnectAttempts.current = 0;

        const token = localStorage.getItem("token");
        if (!token) {
          console.error("No token available for WebSocket auth");
          setError("Session expired. Please log in again.");
          ws.current.close();
          navigate("/");
          return;
        }
        console.log("Sending auth token:", token.slice(0, 10) + "...");
        ws.current.send(
          JSON.stringify({
            type: "auth",
            token: token,
          })
        );
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("Received WebSocket message:", data);

          if (!data.type) {
            console.warn("WebSocket message missing type:", data);
            setError("Invalid message received from server.");
            return;
          }

          switch (data.type) {
            case "message": {
              console.log("Processing message:", data);
              // Validate message data
              if (!data.sender_id || !data.receiver_id || !isValidUUID(data.sender_id) || !isValidUUID(data.receiver_id)) {
                console.error("Invalid message data:", { sender_id: data.sender_id, receiver_id: data.receiver_id });
                setError("Received invalid message data.");
                return;
              }

              // Check if message belongs to the current chat
              if (
                (data.sender_id === currentUser?.id && data.receiver_id === selectedUser?.id) ||
                (data.receiver_id === currentUser?.id && data.sender_id === selectedUser?.id)
              ) {
                console.log("Message matches current chat, updating UI...");
                setMessages((prev) => {
                  // Prevent duplicates
                  const exists = prev.some(
                    (m) => (m.message_id && m.message_id === data.message_id) || (m.temp_id && m.temp_id === data.temp_id)
                  );
                  if (exists) {
                    console.log("Message already exists, updating:", data);
                    return prev.map((m) =>
                      (m.message_id && m.message_id === data.message_id) || (m.temp_id && m.temp_id === data.temp_id)
                        ? {
                            ...m,
                            message_id: data.message_id || m.message_id,
                            temp_id: data.temp_id ? undefined : m.temp_id,
                            text: data.text || m.text,
                            media_url: data.media_url || m.media_url,
                            media_type: data.media_type || m.media_type || (
                              data.media_url?.match(/\.(jpg|jpeg|png|gif)$/i) ? "image" :
                              data.media_url?.match(/\.(mp4|webm|ogg)$/i) ? "video" : "file"
                            ),
                            file_name: data.file_name || m.file_name,
                            created_at: data.created_at || m.created_at,
                            sender_id: data.sender_id,
                            receiver_id: data.receiver_id,
                            sender_name: data.sender_name || m.sender_name || currentUser?.username,
                            edited: data.edited || m.edited || false,
                            key: generateMessageKey(data),
                          }
                        : m
                    );
                  }
                  console.log("Adding new message to state:", data);
                  const newMessage = {
                    ...data,
                    message_id: data.message_id || data.temp_id,
                    temp_id: data.temp_id ? undefined : data.temp_id,
                    sender_name: data.sender_name || (data.sender_id === currentUser?.id ? currentUser.username : selectedUser?.username),
                    media_type: data.media_type || (
                      data.media_url?.match(/\.(jpg|jpeg|png|gif)$/i) ? "image" :
                      data.media_url?.match(/\.(mp4|webm|ogg)$/i) ? "video" : "file"
                    ),
                    edited: data.edited || false,
                    key: generateMessageKey(data),
                  };
                  return [...prev, newMessage];
                });
              } else {
                console.log("Message ignored, does not match current chat:", {
                  sender_id: data.sender_id,
                  receiver_id: data.receiver_id,
                  currentUserId: currentUser?.id,
                  selectedUserId: selectedUser?.id,
                });
              }
              break;
            }
            case "edit": {
              console.log("Processing edit:", data);
              setMessages((prev) =>
                prev.map((m) =>
                  m.message_id === data.message_id
                    ? { ...m, text: data.text, edited: true, edited_at: data.edited_at || new Date().toISOString() }
                    : m
                )
              );
              break;
            }
            case "delete": {
              console.log("Processing delete:", data);
              setMessages((prev) => prev.filter((m) => m.message_id !== data.message_id));
              break;
            }
            case "user_status": {
              console.log("Updating user status:", data);
              setUsers((prev) =>
                prev.map((u) =>
                  u.id === data.user_id ? { ...u, is_online: data.is_online } : u
                )
              );
              break;
            }
            case "connection": {
              console.log("Connection status:", data.status);
              break;
            }
            case "error": {
              console.error("WebSocket error message:", data.error);
              setError(data.error);
              if (data.error.includes("Invalid token") || data.error.includes("User not found")) {
                localStorage.removeItem("token");
                navigate("/");
              }
              break;
            }
            default: {
              console.warn("Unhandled WebSocket message type:", data.type);
            }
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
          setError("Error receiving message. Please check your connection.");
        }
      };

      ws.current.onerror = (error) => {
        console.error("WebSocket error:", error);
        setConnectionStatus("error");
        setError("WebSocket connection error. Attempting to reconnect...");
      };

      ws.current.onclose = (event) => {
        console.log("WebSocket disconnected:", { code: event.code, reason: event.reason });
        setConnectionStatus("disconnected");

        if (reconnectAttempts.current < 5) {
          reconnectAttempts.current++;
          const timeout = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
          console.log(`Scheduling reconnect in ${timeout}ms (attempt ${reconnectAttempts.current})`);
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log(`Attempting to reconnect... (attempt ${reconnectAttempts.current})`);
            connectWebSocket();
          }, timeout);
        } else {
          console.error("Max reconnection attempts reached");
          setError("Failed to reconnect to WebSocket. Polling enabled to keep messages updated.");
        }
      };
    } catch (error) {
      console.error("Error creating WebSocket connection:", error);
      setConnectionStatus("error");
      setError("Failed to establish WebSocket connection.");
    }
  }, [currentUser, navigate, selectedUser]);

  useEffect(() => {
    if (currentUser) {
      console.log("Triggering WebSocket connection for user:", currentUser.id);
      connectWebSocket();
    }

    return () => {
      console.log("Cleaning up WebSocket");
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [currentUser, connectWebSocket]);

  // Fallback: Edit message via REST API
  const editMessageViaAPI = async (messageId, text) => {
    const token = localStorage.getItem("token");
    try {
      const response = await axios.put(
        `${API_URL}/messages/${messageId}`,
        { text: text.trim() },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      console.log("Message edited via API:", response.data);
      // Fetch messages to update UI
      await fetchMessages();
      return response.data;
    } catch (error) {
      console.error("Error editing message via API:", error.response?.data || error.message);
      setError(error.response?.data?.detail || "Failed to edit message. Please try again.");
      throw error;
    }
  };

  // Fallback: Delete message via REST API
  const deleteMessageViaAPI = async (messageId) => {
    const token = localStorage.getItem("token");
    try {
      const response = await axios.delete(
        `${API_URL}/messages/${messageId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      console.log("Message deleted via API:", response.data);
      // Fetch messages to update UI
      await fetchMessages();
      return response.data;
    } catch (error) {
      console.error("Error deleting message via API:", error.response?.data || error.message);
      setError(error.response?.data?.detail || "Failed to delete message. Please try again.");
      throw error;
    }
  };

  // Handle file upload
  const handleFileUpload = async (file) => {
    if (!file || !selectedUser) {
      console.error("No file or selected user for upload");
      setError("Please select a file and a user to send to.");
      return;
    }

    setUploadingFile(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const token = localStorage.getItem("token");
      const response = await axios.post(`${API_URL}/upload`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "multipart/form-data",
        },
      });

      const tempId = Date.now().toString();
      const msgObj = {
        type: "message",
        receiver_id: selectedUser.id,
        text: message || "",
        media_url: response.data.url,
        media_type: response.data.media_type,
        file_name: response.data.filename,
        temp_id: tempId,
      };

      // Optimistic UI update
      setMessages((prev) => [
        ...prev,
        {
          ...msgObj,
          sender_id: currentUser.id,
          sender_name: currentUser.username,
          created_at: new Date().toISOString(),
          message_id: tempId,
          edited: false,
          key: generateMessageKey({ ...msgObj, message_id: tempId }),
        },
      ]);

      if (ws.current?.readyState === WebSocket.OPEN) {
        console.log("Sending file message via WebSocket:", msgObj);
        ws.current.send(JSON.stringify(msgObj));
      } else {
        console.error("WebSocket not connected for file message");
        setError("Connection lost. Trying to reconnect...");
        connectWebSocket();
      }

      setMessage("");
      fileInputRef.current.value = "";
    } catch (error) {
      console.error("Error uploading file:", error.response?.data || error.message);
      setError(error.response?.data?.detail || "Failed to upload file. Please try again.");
    } finally {
      setUploadingFile(false);
    }
  };

  // Send message
  const handleSendMessage = async () => {
    if (!currentUser || !selectedUser) {
      console.error("Cannot send message: missing user data", { currentUser, selectedUser });
      setError("Please select a user and ensure you are logged in.");
      return;
    }
    if (!message.trim() && !fileInputRef.current?.files?.length) {
      console.warn("No message or file to send");
      return;
    }
    if (ws.current?.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not connected");
      setError("Connection lost. Trying to reconnect...");
      connectWebSocket();
      return;
    }

    if (fileInputRef.current?.files?.length) {
      await handleFileUpload(fileInputRef.current.files[0]);
      return;
    }

    const tempId = Date.now().toString();
    const msgObj = {
      type: "message",
      receiver_id: selectedUser.id,
      text: message.trim(),
      media_url: null,
      media_type: null,
      file_name: null,
      temp_id: tempId,
    };

    // Optimistic UI update
    setMessages((prev) => [
      ...prev,
      {
        ...msgObj,
        sender_id: currentUser.id,
        sender_name: currentUser.username,
        created_at: new Date().toISOString(),
        message_id: tempId,
        edited: false,
        key: generateMessageKey({ ...msgObj, message_id: tempId }),
      },
    ]);

    console.log("Sending message via WebSocket:", msgObj);
    ws.current.send(JSON.stringify(msgObj));
    setMessage("");
  };

  // Edit message
  const handleEditMessage = async (messageId) => {
    if (!editText.trim()) {
      console.warn("Cannot edit message: empty text");
      setError("Cannot edit message. Text cannot be empty.");
      return;
    }

    const editObj = {
      type: "edit",
      message_id: messageId,
      text: editText.trim(),
    };

    // Optimistic UI update
    setMessages((prev) =>
      prev.map((m) =>
        m.message_id === messageId
          ? { ...m, text: editText.trim(), edited: true, edited_at: new Date().toISOString() }
          : m
      )
    );

    if (ws.current?.readyState === WebSocket.OPEN) {
      console.log("Sending edit message via WebSocket:", editObj);
      ws.current.send(JSON.stringify(editObj));
    } else {
      console.warn("WebSocket not connected, using API fallback for edit");
      setError("Connection lost. Saving edit via API...");
      try {
        await editMessageViaAPI(messageId, editText);
      } catch (error) {
        // Revert optimistic update on failure
        setMessages((prev) =>
          prev.map((m) =>
            m.message_id === messageId
              ? { ...m, text: m.text, edited: m.edited || false, edited_at: m.edited_at || null }
              : m
          )
        );
        connectWebSocket();
        return;
      }
    }

    setEditingMessageId(null);
    setEditText("");
  };

  // Delete message
  const handleDeleteMessage = async (messageId) => {
    if (window.confirm("Are you sure you want to delete this message?")) {
      const deleteObj = {
        type: "delete",
        message_id: messageId,
      };

      // Optimistic UI update
      setMessages((prev) => prev.filter((m) => m.message_id !== messageId));

      if (ws.current?.readyState === WebSocket.OPEN) {
        console.log("Sending delete message via WebSocket:", deleteObj);
        ws.current.send(JSON.stringify(deleteObj));
      } else {
        console.warn("WebSocket not connected, using API fallback for delete");
        setError("Connection lost. Deleting via API...");
        try {
          await deleteMessageViaAPI(messageId);
        } catch (error) {
          // Revert optimistic update on failure
          await fetchMessages();
          connectWebSocket();
          return;
        }
      }
    }
  };

  // Start editing
  const startEditing = (msg) => {
    if (!msg.message_id) {
      console.error("No message_id for editing:", msg);
      setError("Cannot edit this message.");
      return;
    }
    setEditingMessageId(msg.message_id);
    setEditText(msg.text || "");
  };

  // Cancel editing
  const cancelEditing = () => {
    setEditingMessageId(null);
    setEditText("");
  };

  const filteredUsers = users.filter((u) =>
    (u.username || u.email || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleLogout = () => {
    console.log("Logging out, clearing token and closing WebSocket");
    localStorage.removeItem("token");
    if (ws.current) {
      ws.current.close();
    }
    navigate("/");
  };

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      {/* Sidebar */}
      <div className="w-80 border-r border-gray-700 flex flex-col">
        <div className="p-4 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <User className="w-8 h-8 p-1 bg-gray-600 rounded-full" />
              <div>
                <p className="font-semibold">{currentUser?.username}</p>
                <p className="text-xs text-gray-400">{currentUser?.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="text-sm px-3 py-1 bg-red-600 hover:bg-red-700 rounded transition-colors"
            >
              Logout
            </button>
          </div>

          <div className="flex items-center space-x-2 text-xs">
            <Circle
              className={`w-2 h-2 fill-current ${
                connectionStatus === "connected"
                  ? "text-green-500"
                  : connectionStatus === "error"
                  ? "text-red-500"
                  : "text-yellow-500"
              }`}
            />
            <span className="text-gray-400">
              {connectionStatus === "connected"
                ? "Connected"
                : connectionStatus === "error"
                ? "Connection Error"
                : "Reconnecting..."}
            </span>
          </div>
        </div>

        <div className="p-4">
          <input
            type="text"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full p-2 rounded bg-gray-800 text-white border border-gray-600 focus:border-blue-500 focus:outline-none transition-colors"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-4">
          <h3 className="text-sm font-semibold text-gray-400 mb-2">CHATS</h3>
          {filteredUsers.length > 0 ? (
            filteredUsers.map((user) => (
              <div
                key={user.id}
                onClick={() => {
                  if (!isValidUUID(user.id)) {
                    console.error("Invalid user ID selected:", user.id);
                    setError("Invalid user ID. Please select a valid user.");
                    return;
                  }
                  console.log("Selecting user:", user);
                  setSelectedUser(user);
                  setError("");
                }}
                className={`cursor-pointer p-3 rounded-lg mb-2 flex items-center justify-between transition-all hover:bg-gray-700 ${
                  selectedUser?.id === user.id ? "bg-blue-600 hover:bg-blue-700" : "bg-gray-800"
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className="relative">
                    <User className="w-10 h-10 p-2 bg-gray-600 rounded-full" />
                    <Circle
                      className={`absolute bottom-0 right-0 w-3 h-3 fill-current border-2 border-gray-800 ${
                        user.is_online ? "text-green-500" : "text-gray-500"
                      }`}
                    />
                  </div>
                  <div>
                    <p className="font-medium">{user.username}</p>
                    <p className="text-xs text-gray-400">
                      {user.is_online ? "Online" : "Offline"}
                    </p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-gray-500 text-sm text-center py-4">No users found</div>
          )}
        </div>
      </div>

      {/* Chat Window */}
      <div className="flex-1 flex flex-col">
        {selectedUser && currentUser ? (
          <>
            <div className="border-b border-gray-700 p-4 bg-gray-800 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <User className="w-10 h-10 p-2 bg-gray-600 rounded-full" />
                <div>
                  <p className="font-semibold">{selectedUser.username}</p>
                  <p className="text-xs text-gray-400">
                    {selectedUser.is_online ? "Online" : "Offline"}
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-600 text-white p-3 mx-4 mt-4 rounded-lg flex justify-between items-center">
                <span>{error}</span>
                <button onClick={() => setError("")} className="text-white hover:text-gray-200">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-850">
              {messages.map((msg) => {
                const isMe = currentUser && msg.sender_id === currentUser.id;
                const isEditing = editingMessageId === msg.message_id;

                return (
                  <div
                    key={msg.key || generateMessageKey(msg)}
                    className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`max-w-[70%] ${isMe ? "order-2" : ""}`}>
                      <div className={`rounded-lg p-3 ${isMe ? "bg-blue-600" : "bg-gray-700"}`}>
                        {msg.media_url && (
                          <div className="mb-2">
                            {msg.media_type === "image" ? (
                              <img
                                src={`${API_URL}${msg.media_url}`}
                                alt={msg.file_name || "Shared image"}
                                className="max-w-full rounded cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => window.open(`${API_URL}${msg.media_url}`, "_blank")}
                                onError={(e) => {
                                  console.error("Image load error:", e);
                                  e.target.style.display = "none";
                                  if (e.target.nextSibling) {
                                    e.target.nextSibling.style.display = "block";
                                  }
                                }}
                              />
                            ) : msg.media_type === "video" ? (
                              <video
                                controls
                                className="max-w-full rounded"
                                src={`${API_URL}${msg.media_url}`}
                                onError={(e) => {
                                  console.error("Video load error:", e);
                                  e.target.style.display = "none";
                                  if (e.target.nextSibling) {
                                    e.target.nextSibling.style.display = "block";
                                  }
                                }}
                              />
                            ) : (
                              <a
                                href={`${API_URL}${msg.media_url}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center space-x-2 text-blue-300 hover:text-blue-200 transition-colors"
                              >
                                <Paperclip className="w-4 h-4" />
                                <span>{msg.file_name || "Download File"}</span>
                              </a>
                            )}
                          </div>
                        )}

                        {isEditing ? (
                          <div className="flex items-center space-x-2">
                            <input
                              type="text"
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              className="flex-1 bg-gray-600 text-white px-2 py-1 rounded focus:outline-none"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleEditMessage(msg.message_id);
                                if (e.key === "Escape") cancelEditing();
                              }}
                              autoFocus
                            />
                            <button
                              onClick={() => handleEditMessage(msg.message_id)}
                              className="p-1 hover:bg-gray-600 rounded transition-colors"
                            >
                              <Check className="w-4 h-4 text-green-400" />
                            </button>
                            <button
                              onClick={cancelEditing}
                              className="p-1 hover:bg-gray-600 rounded transition-colors"
                            >
                              <X className="w-4 h-4 text-red-400" />
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm break-words">
                            {msg.text}
                            {msg.edited && <span className="text-xs text-gray-400 ml-2">(edited)</span>}
                          </p>
                        )}
                      </div>

                      {isMe && !isEditing && msg.message_id && (
                        <div className="flex justify-end space-x-1 mt-1">
                          <button
                            onClick={() => startEditing(msg)}
                            className="p-1 text-gray-400 hover:text-white transition-colors"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteMessage(msg.message_id)}
                            className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      <p className={`text-xs text-gray-500 mt-1 ${isMe ? "text-right" : ""}`}>
                        {new Date(msg.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-gray-700 p-4 bg-gray-800">
              <div className="flex items-center space-x-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => e.target.files?.length && handleFileUpload(e.target.files[0])}
                  className="hidden"
                  accept="image/*,video/*,.pdf,.doc,.docx,.txt"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  className="p-2 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
                >
                  <Paperclip className="w-5 h-5" />
                </button>

                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 p-2 rounded bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:outline-none transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  disabled={uploadingFile}
                />

                <button
                  onClick={handleSendMessage}
                  disabled={(!message.trim() && !fileInputRef.current?.files?.length) || uploadingFile}
                  className="p-2 bg-blue-600 rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploadingFile ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-850">
            <div className="text-center">
              <User className="w-20 h-20 p-4 bg-gray-700 rounded-full mx-auto mb-4" />
              <p className="text-xl text-gray-400">Select a user to start chatting</p>
              <p className="text-sm text-gray-500 mt-2">Choose from the list on the left</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


export default ChatPage;
