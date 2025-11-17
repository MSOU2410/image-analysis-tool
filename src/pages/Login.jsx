import React, { useState } from "react";
import { login } from "../authService";
import { Box, Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { Link, useNavigate } from "react-router-dom";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = async () => {
    setError("");
    try {
      await login(email, password);
      navigate("/"); // redirect to homepage
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Box sx={{ display: "flex", justifyContent: "center", mt: 8 }}>
      <Paper sx={{ p: 4, width: 320 }}>
        <Typography variant="h5" sx={{ mb: 2 }}>Login</Typography>

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

          <Button variant="contained" onClick={handleLogin}>
            Login
          </Button>

          <Typography variant="body2">
            Don't have an account? <Link to="/signup">Sign up</Link>
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
}
