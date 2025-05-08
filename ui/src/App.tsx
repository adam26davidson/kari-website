import Header from "./components/header/header";
import "./App.css";
import { Route, Routes } from "react-router-dom";
import Home from "./pages/homePage/homePage";
import { HaikuPage } from "./pages/haikuPage/haikuPage";
import { HaigaPage } from "./pages/haigaPage/haigaPage";
import { BlogList } from "./pages/blog-list/blog-list";
import Admin from "./pages/admin/admin";
import { useIsMobile } from "./hooks/isMobile";
import { MobileMenu } from "./components/mobileMenu/mobileMenu";
import { useState } from "react";
import { BlogPost } from "./pages/blog-post/blog-post";

function App() {
  const [showingMobileMobileMenu, setShowingMobileMenu] = useState(false);
  const isMobile = useIsMobile();
  return (
    <>
      <div className="whole-page">
        <Header
          showingMobileMenu={showingMobileMobileMenu}
          setShowingMobileMenu={setShowingMobileMenu}
        />
        <div className="content">
          {isMobile && showingMobileMobileMenu && (
            <MobileMenu setShowingMobileMenu={setShowingMobileMenu} />
          )}
          {!showingMobileMobileMenu && (
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="haiku" element={<HaikuPage />} />
              <Route path="haiga" element={<HaigaPage />} />
              <Route path="blog" element={<BlogList />} />
              <Route path="blog/:id" element={<BlogPost />} />
              <Route path="admin" element={<Admin />} />
            </Routes>
          )}
        </div>
      </div>
    </>
  );
}

export default App;
