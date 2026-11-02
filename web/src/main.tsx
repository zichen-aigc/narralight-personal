import React from "react";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "./styles/globals.css";
import { RouterProvider } from "react-router";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n";
import { installRuntimeAxiosGuard, installRuntimeFetchGuard } from "@/lib/runtime-version-guard";
import { router } from "@/router";

installRuntimeFetchGuard();
installRuntimeAxiosGuard();
document.body.style.fontFamily = '"Noto Sans SC","PingFang SC","Microsoft YaHei","Segoe UI",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <RouterProvider router={router} />
        </AppProviders>
    </React.StrictMode>,
);
