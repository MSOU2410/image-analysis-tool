// src/pages/MyWorkPage.jsx
import React, { useEffect, useState } from "react";
import { auth, db, storage } from "../firebase";
import { useNavigate } from "react-router-dom";
import { logout } from "../authService";

import {
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
} from "firebase/firestore";

import { deleteObject, ref } from "firebase/storage";

import {
  Box,
  Typography,
  Paper,
  Button,
  CircularProgress,
  Stack,
  Divider,
} from "@mui/material";

export default function MyWorkPage() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true); // only controls session loading
  const [user, setUser] = useState(null);

  const navigate = useNavigate();

  /* -------------------- Listen for Firebase Auth -------------------- */
  useEffect(() => {
    const unsub = auth.onAuthStateChanged((u) => {
      setUser(u);

      // If user logs out → kick back to login
      if (!u) navigate("/login");
    });
    return () => unsub();
  }, [navigate]);

  /* -------------------- Load Sessions -------------------- */
  useEffect(() => {
    const loadSessions = async () => {
      if (user === null) return; // still waiting for Firebase
      if (!user) return; // user is logged out — already redirected

      const q = query(
        collection(db, "sessions"),
        where("userId", "==", user.uid)
      );

      const snap = await getDocs(q);
      const results = [];

      snap.forEach((doc) => {
        results.push({
          id: doc.id,
          ...doc.data(),
        });
      });

      // Sort newest first
      results.sort((a, b) => b.createdAt - a.createdAt);

      setSessions(results);
      setLoading(false);
    };

    loadSessions();
  }, [user]);

  /* -------------------- Delete a Session -------------------- */
  const deleteSession = async (session) => {
    if (!window.confirm("Delete this saved session?")) return;

    try {
      // Delete Firestore doc
      await deleteDoc(doc(db, "sessions", session.id));

      // Delete image file from storage
      if (session.imageURL) {
        const path = decodeURIComponent(
          session.imageURL.split("/o/")[1].split("?")[0]
        );
        const imgRef = ref(storage, path);
        await deleteObject(imgRef);
      }

      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      alert("Session deleted.");
    } catch (err) {
      console.error(err);
      alert("Failed to delete session.");
    }
  };

  /* -------------------- Loading UI -------------------- */
  if (loading) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  /* -------------------- Main UI -------------------- */
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ mb: 2 }}>
        My Saved Work
      </Typography>

      <Button
        variant="outlined"
        color="error"
        sx={{ mb: 2 }}
        onClick={async () => {
          await logout();
          navigate("/login");
        }}
      >
        Logout
      </Button>

      {sessions.length === 0 && (
        <Typography>No saved sessions yet.</Typography>
      )}

      <Stack spacing={2}>
        {sessions.map((s) => (
          <Paper key={s.id} sx={{ p: 2 }}>
            <Typography variant="h6">
              Saved on {new Date(s.createdAt).toLocaleString()}
            </Typography>

            <Divider sx={{ my: 1 }} />

            <Stack direction="row" spacing={2}>
              {/* Thumbnail */}
              {s.imageURL && (
                <img
                  src={s.imageURL}
                  alt="session-img"
                  style={{
                    width: 120,
                    height: "auto",
                    borderRadius: 6,
                    border: "1px solid #ccc",
                  }}
                />
              )}

              <Stack spacing={1}>
                <Button
                  variant="contained"
                  onClick={() => navigate(`/load/${s.id}`)}
                >
                  Load Session
                </Button>

                <Button
                  variant="outlined"
                  color="error"
                  onClick={() => deleteSession(s)}
                >
                  Delete
                </Button>
              </Stack>
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}
