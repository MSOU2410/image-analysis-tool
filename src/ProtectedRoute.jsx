import { Navigate } from "react-router-dom";
import { auth } from "./firebase";

export default function ProtectedRoute({ children }) {
  const user = auth.currentUser;
  return user ? children : <Navigate to="/login" replace />;
}
