import React, { useState } from "react";
import { signup } from "../authService";
import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { Link } from "react-router-dom";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSignup = async () => {
    setError("");
    try {
      await signup(email, password);
      alert("Account created! You can now log in.");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
      <Paper sx={{ p: 4, width: 320 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>Sign Up</Typography>

        <Stack spacing={2}>
          <TextField 
            label="Email" 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            fullWidth
          />

          <TextField 
            label="Password" 
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
          />

          {error && (
            <Typography color="error" variant="body2">{error}</Typography>
          )}

          <Button variant="contained" onClick={handleSignup}>
            Create Account
          </Button>

          <Typography variant="body2">
            Already have an account? <Link to="/login">Log in</Link>
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
