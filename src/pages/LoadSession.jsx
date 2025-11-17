// src/pages/LoadSession.jsx
import React, { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { doc, getDoc } from "firebase/firestore";
import { Box, CircularProgress, Typography } from "@mui/material";

export default function LoadSession() {
  const { id } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      const user = auth.currentUser;
      if (!user) return navigate("/login");

      const ref = doc(db, "sessions", id);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        alert("Session not found.");
        return navigate("/mywork");
      }

      const data = snap.data();

      // Save to localStorage so ImageCanvas can read it
      localStorage.setItem("loadedSession", JSON.stringify(data));

      // Redirect to canvas
      navigate("/");
    };

    load();
  }, [id, navigate]);

  return (
    <Box sx={{ p: 4, textAlign: "center" }}>
      <CircularProgress />
      <Typography sx={{ mt: 2 }}>Loading session...</Typography>
    </Box>
  );
}
