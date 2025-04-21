import { useState } from "react";
import "./admin.css";
import AdminHaikuPage from "./adminHaikuPage/adminHaikuPage";
import { useAuth0 } from "@auth0/auth0-react";
import AdminHaigaPage from "./adminHaigaPage/adminHaigaPage";
import { HomePageEditor } from "./homePageEditor/homePageEditor";

type Page = "home" | "haiku" | "haiga" | "blog";

export interface Loading {
  isLoading: boolean;
  message: string;
}

export interface Confirmation {
  message: string;
  show: boolean;
  options: Array<{ label: string; callback: () => void }>;
}

function Admin() {
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();
  const [loading, setLoading] = useState<Loading>({
    isLoading: false,
    message: "",
  });
  const [confirmation, setConfirmation] = useState<Confirmation>({
    message: "",
    show: false,
    options: [],
  });

  return (
    <>
      <div className="admin-container">
        {!isAuthenticated && !isLoading && (
          <button
            className="admin-login-button"
            onClick={() => loginWithRedirect()}
          >
            Log In
          </button>
        )}
        {isAuthenticated && !isLoading && (
          <>
            <div className="admin-menu">
              {["home", "haiku", "haiga", "blog"].map((page) => (
                <div
                  key={page}
                  className={`admin-menu-item ${
                    currentPage === page ? "selected" : ""
                  }`}
                  onClick={() => setCurrentPage(page as Page)}
                >
                  {page.charAt(0).toUpperCase() + page.slice(1)}
                </div>
              ))}
            </div>
            <div className="admin-content">
              {confirmation.show && (
                <div className="admin-confirmation">
                  {confirmation.message}
                  <div className="admin-confirmation-options">
                    {confirmation.options.map((option, idx) => (
                      <button
                        className="admin-confirmation-option"
                        key={idx}
                        onClick={() => {
                          option.callback();
                          setConfirmation({ ...confirmation, show: false });
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {loading.isLoading && (
                <div className="admin-loading">{loading.message}</div>
              )}
              {currentPage === "home" && (
                <HomePageEditor setLoading={setLoading} isLoading={isLoading}/>
              )}
              {currentPage === "haiku" && (
                <AdminHaikuPage
                  setLoading={setLoading}
                  isConfirming={confirmation.show}
                  setConfirmation={setConfirmation}
                  isLoading={loading.isLoading}
                />
              )}
              {currentPage === "haiga" && (
                <AdminHaigaPage
                  setLoading={setLoading}
                  isConfirming={confirmation.show}
                  setConfirmation={setConfirmation}
                  isLoading={loading.isLoading}
                />
              )}
              {currentPage === "blog" && <div>Blog</div>}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default Admin;
