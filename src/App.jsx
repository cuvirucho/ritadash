import { useEffect, useState } from "react";
import "./App.css";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import Navigator from "./components/Navigator";

function App() {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const auth = getAuth();
    signInWithEmailAndPassword(auth, "daniel.eonerdo@gmail.com", "123456789")
      .then(() => setAuthed(true))
      .catch((err) => console.error("Login error:", err));
  }, []);

  if (!authed)
    return (
      <p style={{ color: "#fff", textAlign: "center", marginTop: "3rem" }}>
        Autenticando...
      </p>
    );

  return <Navigator />;
}
export default App;
