import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { ArrowRight, Check, Download, FileUp, FolderOpen, Images as ImageIcon, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button, Dropdown, Image, Input } from "antd";
import { type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { type MenuProps } from "antd";
import { type CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { readZip } from "@/lib/zip";
import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { setMediaBlob } from "@/services/platform-file-storage";
import { setImageBlob } from "@/services/platform-image-storage";
import { useAgentStore } from "@/stores/use-agent-store";
import { createPersistedCanvasProject, renamePersistedCanvasProject, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

import type { CanvasExportFile } from "@/types/canvas-export";

import { getProjectCover, getProjectMediaCount } from "./project-center-utils";

const CINEMA_FALLBACK = "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=2400&q=88";

function formatDate(value: string, locale?: string) {
    return new Date(value).toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function ProjectCard({
    project,
    index,
    onRenamed,
    onExport,
}: {
    project?: CanvasProject;
    index: number;
    onRenamed?: (project: CanvasProject) => void;
    onExport: (projectId: string, title: string) => void;
}) {
    const { i18n, t } = useTranslation();
    const navigate = useNavigate();
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const id = project?.id || "";
    const title = project?.title || t("canvas.project.untitled");
    const cover = project ? getProjectCover(project) : "";
    const selected = selectedIds.includes(id);
    const trashed = void 0 === "trashed";
    const canRename = Boolean(project);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const [saving, setSaving] = useState(false);
    const [renameError, setRenameError] = useState("");
    const savingRef = useRef(false);
    const composingRef = useRef(false);
    const beginRename = async () => {
        if (!canRename || savingRef.current) return;
        try {
            if (!useCanvasStore.getState().projects.some((item) => item.id === id)) throw new Error("项目内容读取失败，请重新打开项目列表");
            setDraft(title);
            setRenameError("");
            setEditing(true);
        } catch (error) {
            setRenameError(error instanceof Error ? error.message : "读取项目失败");
        }
    };
    const saveRename = async () => {
        if (!canRename || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setRenameError("");
        try {
            const renamed = await renamePersistedCanvasProject(id, draft);
            onRenamed?.(renamed);
            setEditing(false);
        } catch (error) {
            setRenameError(error instanceof Error ? error.message : "保存失败，请重试");
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };
    const menuItems: MenuProps["items"] = [
        ...(canRename ? [{ key: "rename", icon: <Pencil aria-hidden="true" />, label: t("projectCenter.rename") }] : []),
        ...(project || null ? [{ key: "export", icon: <Download aria-hidden="true" />, label: t("projectCenter.exportProject") }] : []),
        ...[],
        ...[{ type: "divider" as const }, { key: "delete", danger: true, icon: <Trash2 aria-hidden="true" />, label: t("projectCenter.delete") }],
    ];

    const handleMenu: MenuProps["onClick"] = ({ key, domEvent }) => {
        domEvent.stopPropagation();
        if (key === "rename") void beginRename();
        if (key === "export") onExport(id, title);
        if (key === "delete") setDeleteIds([id]);
    };
    const coverStyle: CSSProperties | undefined = cover ? { backgroundImage: `url("${cover.replace(/"/g, "%22")}")` } : undefined;
    const canOpen = Boolean((project || null) && !trashed && void 0 !== "none");
    const openProject = async () => {
        if (!canOpen) return;

        navigate(`/canvas/${id}`);
    };

    return (
        <article className={`nl-project-card${selected ? " is-selected" : ""}`}>
            <button
                type="button"
                className={`nl-project-cover fallback-${index % 3}`}
                style={coverStyle}
                disabled={!canOpen}
                onClick={() => void openProject()}
                aria-label={canOpen ? t("projectCenter.openProject", { name: title }) : title}
            >
                {!cover ? <span aria-hidden="true">{title.slice(0, 1)}</span> : null}
            </button>
            <div className="nl-project-card-copy">
                <div>
                    {editing && canRename ? (
                        <div className="flex min-w-0 items-center gap-1" role="group" aria-label="重命名项目">
                            <Input
                                className="min-w-0 flex-1"
                                value={draft}
                                disabled={saving}
                                maxLength={200}
                                autoFocus
                                aria-label="项目名称"
                                status={renameError ? "error" : undefined}
                                onFocus={(event) => event.target.select()}
                                onChange={(event) => setDraft(event.target.value)}
                                onCompositionStart={() => {
                                    composingRef.current = true;
                                }}
                                onCompositionEnd={() => {
                                    composingRef.current = false;
                                }}
                                onKeyDown={(event) => {
                                    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
                                    if (event.key === "Enter") {
                                        event.preventDefault();
                                        void saveRename();
                                    }
                                    if (event.key === "Escape" && !savingRef.current) {
                                        setEditing(false);
                                        setRenameError("");
                                    }
                                }}
                            />
                            <Button
                                className="shrink-0"
                                type="text"
                                size="small"
                                loading={saving}
                                disabled={!draft.trim()}
                                icon={<Check size={16} aria-hidden="true" />}
                                onClick={() => void saveRename()}
                                aria-label={t("canvas.project.saveName")}
                            />
                            <Button
                                className="shrink-0"
                                type="text"
                                size="small"
                                disabled={saving}
                                icon={<X size={16} aria-hidden="true" />}
                                onClick={() => {
                                    setEditing(false);
                                    setRenameError("");
                                }}
                                aria-label={t("canvas.project.cancelRename")}
                            />
                        </div>
                    ) : (
                        <button
                            type="button"
                            className="group flex w-full items-center gap-2"
                            disabled={canRename ? false : !canOpen}
                            aria-label={canRename ? `重命名项目：${title}` : t("projectCenter.openProject", { name: title })}
                            title={canRename ? "点击名称即可修改" : title}
                            onClick={() => (canRename ? void beginRename() : void openProject())}
                        >
                            <strong className="min-w-0">{title}</strong>
                            {canRename ? <Pencil className="shrink-0 opacity-50 group-hover:opacity-100" size={12} aria-hidden="true" /> : null}
                        </button>
                    )}
                    {renameError ? (
                        <p className="mt-1 text-xs text-[var(--nl-ivory-muted)]" role="alert">
                            {renameError}
                        </p>
                    ) : null}
                    <small>{t("projectCenter.projectStats", { nodes: project?.nodes.length ?? 0, connections: project?.connections.length ?? 0 })}</small>
                    {null}
                </div>
                <span>{formatDate(project?.updatedAt || void 0 || new Date().toISOString(), i18n.resolvedLanguage)}</span>
            </div>
            {project || null ? (
                <label className="nl-project-select">
                    <input type="checkbox" checked={selected} onChange={(event) => toggleSelected(id, event.target.checked)} />
                    <span className="sr-only">{t("canvas.project.select", { name: title })}</span>
                </label>
            ) : null}
            {menuItems.length ? (
                <Dropdown menu={{ items: menuItems, onClick: handleMenu }} placement="bottomRight" trigger={["click"]}>
                    <button type="button" className="nl-project-more" aria-label={t("projectCenter.projectMenu", { name: title })} onClick={(event) => event.stopPropagation()}>
                        <MoreHorizontal aria-hidden="true" />
                    </button>
                </Dropdown>
            ) : null}
        </article>
    );
}

export default function ProjectCenterPage() {
    const { message, modal } = App.useApp();
    const { i18n, t } = useTranslation();
    const navigate = useNavigate();

    const inputRef = useRef<HTMLInputElement>(null);
    const creatingProjectRef = useRef(false);

    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const agentConnected = useAgentStore((state) => state.connected);

    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);

    const [creatingProject, setCreatingProject] = useState(false);

    const [stagingImport, setStagingImport] = useState(false);
    const currentProject = projects[0];

    const currentCover = getProjectCover(currentProject);
    const selectedProjects = useMemo(() => projects.filter((project) => selectedIds.includes(project.id)), [projects, selectedIds]);

    const totalNodes = useMemo(() => projects.reduce((sum, project) => sum + project.nodes.length, 0), [false, projects]);
    const mediaCount = getProjectMediaCount(currentProject);

    useEffect(() => {
        void fetchPrompts({ pageSize: 6 })
            .then((data) => setPromptShowcase(data.items))
            .catch(() => undefined);
    }, []);

    useEffect(() => {}, [false]);

    useEffect(() => {}, [false]);

    const createAndEnter = async () => {
        if (creatingProjectRef.current) return;
        creatingProjectRef.current = true;
        setCreatingProject(true);
        try {
            const id = await createPersistedCanvasProject(t("canvas.defaultTitle", { count: projects.length + 1 }));
            navigate(`/canvas/${id}`);
        } catch {
            message.error(t("canvas.projectSaveFailed"));
        } finally {
            creatingProjectRef.current = false;
            setCreatingProject(false);
        }
    };
    const openCurrentProject = async (projectId: string) => {
        try {
            await useCanvasStore.persist.rehydrate();
            navigate(`/canvas/${projectId}`);
        } catch {
            message.error("项目内容读取失败，请重试");
        }
    };
    const importCanvas = async (file?: File) => {
        if (!file) return;
        setStagingImport(true);
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            if (data.app !== "infinite-canvas" || ![3, 4].includes(data.version) || !Array.isArray(data.projects) || !data.projects.length) throw new Error("invalid projects.json");
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            message.success(t("canvas.imported", { count: data.projects.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas.importFailed"));
        } finally {
            setStagingImport(false);
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    const projectById = new Map(projects.map((project) => [project.id, project]));

    if (!hydrated && !false) {
        return (
            <main className="nl-project-center is-loading" aria-busy="true">
                <div className="nl-project-skeleton">
                    <span />
                    <span />
                    <span />
                </div>
                <p>{t("canvas.loading")}</p>
            </main>
        );
    }

    const heroStyle: CSSProperties = { backgroundImage: `url("${(currentCover || CINEMA_FALLBACK).replace(/"/g, "%22")}")` };
    const currentTitle = currentProject?.title || void 0;
    const currentId = currentProject?.id || void 0;

    return (
        <main className="nl-project-center">
            <section className="nl-project-stage" aria-labelledby="project-center-title">
                <div
                    className="nl-project-scene"
                    style={heroStyle}
                    role="img"
                    aria-label={currentCover && currentProject ? t("projectCenter.projectSceneAlt", { name: currentProject.title }) : t("projectCenter.fallbackSceneAlt")}
                />
                <div className="nl-project-shade" aria-hidden="true" />

                <div className="nl-project-hero">
                    <h1 id="project-center-title">{currentTitle || t("projectCenter.emptyTitle")}</h1>
                    <p>{currentTitle ? t("projectCenter.continueDescription") : t("projectCenter.emptyDescription")}</p>
                    <dl className="nl-project-metrics">
                        <div>
                            <dt>{t("projectCenter.projectCount")}</dt>
                            <dd>{projects.length}</dd>
                        </div>
                        <div>
                            <dt>{t("projectCenter.nodeCount")}</dt>
                            <dd>{currentProject?.nodes.length ?? 0}</dd>
                        </div>
                        <div>
                            <dt>{t("projectCenter.updated")}</dt>
                            <dd>{currentProject || null ? formatDate((currentProject || null)!.updatedAt, i18n.resolvedLanguage) : "—"}</dd>
                        </div>
                    </dl>
                    <div className="nl-project-actions">
                        <Button
                            type="primary"
                            className="nl-primary-action"
                            loading={!currentId && creatingProject}
                            onClick={currentId ? () => void openCurrentProject(currentId) : () => void createAndEnter()}
                        >
                            <span>{currentId ? t("projectCenter.continue") : t("projectCenter.newProject")}</span>
                            <ArrowRight aria-hidden="true" />
                        </Button>
                        <Button className="nl-secondary-action" icon={<FileUp aria-hidden="true" />} loading={stagingImport} onClick={() => inputRef.current?.click()}>
                            {stagingImport ? "正在校验项目包" : t("projectCenter.importProject")}
                        </Button>
                        {null}
                    </div>
                </div>

                <aside className="nl-live-panel" aria-labelledby="live-status-title">
                    <div className="nl-live-heading">
                        <h2 id="live-status-title">{t("projectCenter.status")}</h2>
                        <span>{t("projectCenter.unifiedData")}</span>
                    </div>
                    <ul>
                        <li>
                            <span className={agentConnected ? "is-live" : ""}>
                                <i aria-hidden="true" />
                            </span>
                            <div>
                                <strong>Agent</strong>
                                <small>{agentConnected ? t("projectCenter.agentConnected") : t("projectCenter.agentDisconnected")}</small>
                            </div>
                            <em>{agentConnected ? "ON" : "OFF"}</em>
                        </li>
                        <li>
                            <span>
                                <FolderOpen aria-hidden="true" />
                            </span>
                            <div>
                                <strong>{t("projectCenter.allProjects")}</strong>
                                <small>{t("projectCenter.totalNodes", { count: totalNodes })}</small>
                            </div>
                            <em>{projects.length}</em>
                        </li>
                        <li>
                            <span>
                                <ImageIcon aria-hidden="true" />
                            </span>
                            <div>
                                <strong>{t("projectCenter.currentMedia")}</strong>
                                <small>{currentTitle || t("projectCenter.noProject")}</small>
                            </div>
                            <em>{mediaCount}</em>
                        </li>
                    </ul>
                    <div className="nl-live-foot">
                        <span className="nl-live-avatar" aria-hidden="true">
                            {"叙".slice(0, 1)}
                        </span>
                        <span>{t("projectCenter.localCreator")}</span>
                    </div>
                </aside>

                <section className="nl-recent-projects" aria-labelledby="recent-projects-title">
                    <div className="nl-recent-intro">
                        <h2 id="recent-projects-title">{t("projectCenter.recentProjects")}</h2>
                        <div>
                            {null}
                            {selectedProjects.length ? (
                                <>
                                    <Button
                                        type="text"
                                        icon={<Download aria-hidden="true" />}
                                        onClick={() => void exportCanvasProjects(selectedProjects, `${t("projectCenter.selectedExportName")}-${selectedProjects.length}`)}
                                    >
                                        {t("projectCenter.exportSelected", { count: selectedProjects.length })}
                                    </Button>
                                    {
                                        <Button type="text" danger icon={<Trash2 aria-hidden="true" />} onClick={() => setDeleteIds(selectedIds)}>
                                            {t("projectCenter.deleteSelected")}
                                        </Button>
                                    }
                                </>
                            ) : null}
                            <Button type="text" icon={<Plus aria-hidden="true" />} loading={creatingProject} onClick={() => void createAndEnter()}>
                                {t("projectCenter.newProject")}
                            </Button>
                        </div>
                    </div>
                    {projects.length ? (
                        projects.slice(0, 3).map((project, index) => (
                            <ProjectCard
                                key={project.id}
                                project={project}
                                index={index}
                                onExport={(id, title) =>
                                    void exportCanvasProjects(
                                        projects.filter((item) => item.id === id),
                                        title,
                                    )
                                }
                            />
                        ))
                    ) : (
                        <div className="nl-recent-empty">
                            <span>{t("projectCenter.noProjects")}</span>
                            <Button type="text" loading={creatingProject} onClick={() => void createAndEnter()}>
                                {t("projectCenter.createNow")}
                            </Button>
                        </div>
                    )}
                </section>
            </section>

            {null}

            <section className="nl-inspiration" aria-labelledby="inspiration-title">
                <header>
                    <div>
                        <h2 id="inspiration-title">{t("projectCenter.inspirationTitle")}</h2>
                        <p>{t("projectCenter.inspirationDescription")}</p>
                    </div>
                    <Button type="text" icon={<ArrowRight aria-hidden="true" />} iconPlacement="end" onClick={() => navigate("/prompts")}>
                        {t("home.viewPrompts")}
                    </Button>
                </header>
                {promptShowcase.length ? (
                    <div className="nl-inspiration-grid">
                        {promptShowcase.map((item, index) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                    setPreviewIndex(index);
                                    setPreviewOpen(true);
                                }}
                            >
                                <img src={item.coverUrl} alt={item.title} />
                                <span>
                                    <strong>{item.title}</strong>
                                    <small>{item.prompt}</small>
                                </span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <p className="nl-inspiration-empty">{t("projectCenter.inspirationEmpty")}</p>
                )}
            </section>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            {<CanvasDeleteProjectsDialog />}

            <Image.PreviewGroup preview={{ open: previewOpen, current: previewIndex, onOpenChange: setPreviewOpen, onChange: setPreviewIndex }}>
                <div className="hidden">
                    {promptShowcase.map((item) => (
                        <Image key={item.id} src={item.coverUrl} alt={item.title} />
                    ))}
                </div>
            </Image.PreviewGroup>
        </main>
    );
}
