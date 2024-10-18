import Header from "./components/header/header";
import "./App.css";
import { Route, Routes } from "react-router-dom";
import Home from "./pages/home/home";
import Haiku from "./pages/haiku/haiku";
import Haiga from "./pages/haiga/haiga";
import Blog from "./pages/blog/blog";
import Admin from "./pages/admin/admin";

function App() {
  return (
    <>
      <div className="whole-page">
        <Header />
        <div className="content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="haiku" element={<Haiku />} />
            <Route path="haiga" element={<Haiga />} />
            <Route path="blog" element={<Blog />} />
            <Route path="admin" element={<Admin />} />
          </Routes>
        </div>
      </div>
    </>
  );
}

export default App;
