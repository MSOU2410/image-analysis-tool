// src/App.jsx
import { BrowserRouter, Routes, Route } from "react-router-dom";

import ImageCanvas from "./components/ImageCanvas";
import StatsPage from "./pages/StatsPage";

import Signup from "./pages/Signup";
import Login from "./pages/Login";

import ProtectedRoute from "./ProtectedRoute";

import MyWorkPage from "./pages/MyWorkPage";
import LoadSession from "./pages/LoadSession";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>

        {/* ---------- Public Pages ---------- */}
        <Route path="/" element={<ImageCanvas />} />
        <Route path="/stats" element={<StatsPage />} />

        {/* ---------- Auth Pages (Public) ---------- */}
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />

        {/* ---------- Protected Pages ---------- */}
        <Route
          path="/mywork"
          element={
            <ProtectedRoute>
              <MyWorkPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/load/:id"
          element={
            <ProtectedRoute>
              <LoadSession />
            </ProtectedRoute>
          }
        />

      </Routes>
    </BrowserRouter>
  );
}
