import { useState } from "react";
import "./admin.css";
import AdminHaikuPage from "./adminHaikuPage/adminHaikuPage";
import { useAuth0 } from "@auth0/auth0-react";
import AdminHaigaPage from "./adminHaigaPage/adminHaigaPage";
import { HomePageEditor } from "./homePageEditor/homePageEditor";
import { AdminOtherWorksPage } from "./adminOtherWorksPage/admin-other-works-page";
import { AdminPhotographyPage } from "./admin-photography-page/admin-photography-page";
import { AdminButton } from "../../components/admin-button/admin-button";

type Page = "home" | "haiku" | "haiga" | "other-works" | "photography";

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
          <AdminButton onClick={() => loginWithRedirect()}>Log In</AdminButton>
        )}
        {isAuthenticated && !isLoading && (
          <>
            <div className="admin-menu">
              {["home", "haiku", "haiga", "photography", "other-works"].map(
                (page) => (
                  <div
                    key={page}
                    className={`admin-menu-item ${
                      currentPage === page ? "selected" : ""
                    }`}
                    onClick={() => setCurrentPage(page as Page)}
                  >
                    {page.charAt(0).toUpperCase() +
                      page.slice(1).replace("-", " ")}
                  </div>
                ),
              )}
            </div>
            <div className="admin-content">
              {confirmation.show && (
                <div className="admin-confirmation">
                  {confirmation.message}
                  <div className="admin-confirmation-options">
                    {confirmation.options.map((option, idx) => (
                      <AdminButton
                        key={idx}
                        onClick={() => {
                          option.callback();
                          setConfirmation({ ...confirmation, show: false });
                        }}
                      >
                        {option.label}
                      </AdminButton>
                    ))}
                  </div>
                </div>
              )}
              {loading.isLoading && (
                <div className="admin-loading">{loading.message}</div>
              )}
              {currentPage === "home" && (
                <HomePageEditor
                  setConfirmation={setConfirmation}
                  setLoading={setLoading}
                  isLoading={loading.isLoading}
                />
              )}
              {currentPage === "haiku" && (
                <AdminHaikuPage
                  setLoading={setLoading}
                  setConfirmation={setConfirmation}
                />
              )}
              {currentPage === "haiga" && (
                <AdminHaigaPage
                  setLoading={setLoading}
                  setConfirmation={setConfirmation}
                />
              )}
              {currentPage === "other-works" && (
                <AdminOtherWorksPage
                  setLoading={setLoading}
                  setConfirmation={setConfirmation}
                />
              )}
              {currentPage === "photography" && (
                <AdminPhotographyPage
                  setLoading={setLoading}
                  setConfirmation={setConfirmation}
                />
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default Admin;
