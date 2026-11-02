import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Building2, ChevronRight, Cpu, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";

import { isImeComposing } from "@/lib/keyboard-event";

import { isModelBackendSupported, useBackendModelContracts } from "@/lib/backend-model-contract";

import { cn } from "@/lib/utils";

import { decodeChannelModel, modelOptionDetails, modelOptionLabel, modelOptionName, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;

    value?: string;

    onChange: (model: string) => void;

    capability?: ModelCapability;

    className?: string;

    fullWidth?: boolean;

    placeholder?: string;

    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder, onMissingConfig }: ModelPickerProps) {
    const { t } = useTranslation();

    const pickerId = useId();

    const [open, setOpen] = useState(false);

    const [query, setQuery] = useState("");

    const [activeIndex, setActiveIndex] = useState(0);

    const [activeProviderIndex, setActiveProviderIndex] = useState(0);

    const [activePane, setActivePane] = useState<"providers" | "models">("models");

    const [selectedChannelId, setSelectedChannelId] = useState("");

    const searchRef = useRef<HTMLInputElement>(null);

    const backendContracts = useBackendModelContracts();

    const modelScrollRef = useRef<HTMLDivElement>(null);

    const options = useMemo(
        () =>
            Array.from(
                new Set(
                    [...(config.channelMode === "local" && !capability ? [value] : []), ...selectableModelsByCapability(config, capability)].filter(
                        (model): model is string => Boolean(model) && isModelBackendSupported(model),
                    ),
                ),
            ),
        [capability, config, value, backendContracts],
    );

    const groupedOptions = useMemo(() => groupModelOptions(config, options, query), [config, options, query]);

    const flatOptions = useMemo(() => groupedOptions.flatMap((group) => group.models), [groupedOptions]);

    const optionIndexes = useMemo(() => new Map(flatOptions.map((model, index) => [model, index])), [flatOptions]);

    const selectedGroup = groupedOptions.find((group) => group.channelId === selectedChannelId) || groupedOptions[0];

    const selectedModels = selectedGroup?.models || [];

    const current = value || "";

    const currentDetails = current ? modelOptionDetails(config, current) : null;

    const pickerPlaceholder = placeholder || t("settingsPanels.model.select");

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) {
                setQuery("");

                setOpen(false);
            }
        };

        window.addEventListener("model-picker-open", closeOtherPicker);

        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    useEffect(() => {
        if (!open) return;

        const frame = requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));

        return () => cancelAnimationFrame(frame);
    }, [open, selectedChannelId]);

    useEffect(() => {
        if (!open || !flatOptions.length) return;

        const boundedIndex = Math.min(activeIndex, flatOptions.length - 1);

        if (boundedIndex !== activeIndex) setActiveIndex(boundedIndex);

        const container = modelScrollRef.current;

        const option = document.getElementById(`${pickerId}-model-option-${boundedIndex}`);

        if (!container || !option || !container.contains(option)) return;

        const optionTop = option.offsetTop;

        const optionBottom = optionTop + option.offsetHeight;

        if (optionTop < container.scrollTop) container.scrollTop = optionTop;
        else if (optionBottom > container.scrollTop + container.clientHeight) container.scrollTop = optionBottom - container.clientHeight;
    }, [activeIndex, flatOptions.length, open, pickerId]);

    useEffect(() => {
        if (!open || !groupedOptions.length) return;

        const selectedIndex = groupedOptions.findIndex((group) => group.channelId === selectedChannelId);

        if (selectedIndex >= 0) {
            if (selectedIndex !== activeProviderIndex) setActiveProviderIndex(selectedIndex);

            return;
        }

        setSelectedChannelId(groupedOptions[0].channelId);

        setActiveProviderIndex(0);

        setActiveIndex(optionIndexes.get(groupedOptions[0].models[0]) || 0);
    }, [activeProviderIndex, groupedOptions, open, optionIndexes, selectedChannelId]);

    const closePicker = () => {
        setQuery("");

        setOpen(false);
    };

    const activateProvider = (index: number, moveToModels = false) => {
        if (!groupedOptions.length) return;

        const boundedIndex = Math.max(0, Math.min(index, groupedOptions.length - 1));

        const group = groupedOptions[boundedIndex];

        setActiveProviderIndex(boundedIndex);

        setSelectedChannelId(group.channelId);

        setActiveIndex(optionIndexes.get(group.models[0]) || 0);

        if (modelScrollRef.current) modelScrollRef.current.scrollTop = 0;

        if (moveToModels) setActivePane("models");
    };

    useEffect(() => {
        if (!open) return;

        const handleWheel = (event: globalThis.WheelEvent) => {
            const content = document.getElementById(`${pickerId}-model-listbox`);

            if (!(event.target instanceof Node) || !content?.contains(event.target)) return;

            const container = modelScrollRef.current;

            if (!container || !event.deltaY) return;

            container.scrollTop = modelPickerScrollTop(container.scrollTop, event.deltaY, container.scrollHeight - container.clientHeight);

            event.preventDefault();

            event.stopPropagation();
        };

        document.addEventListener("wheel", handleWheel, { capture: true, passive: false });

        return () => document.removeEventListener("wheel", handleWheel, true);
    }, [open, pickerId]);

    const handleKeyboard = (event: KeyboardEvent<HTMLInputElement>) => {
        event.stopPropagation();

        if (isImeComposing(event)) return;

        if (event.key === "Escape") {
            event.preventDefault();

            closePicker();

            return;
        }

        if (event.key === "ArrowLeft") {
            event.preventDefault();

            setActivePane("providers");

            return;
        }

        if (event.key === "ArrowRight") {
            event.preventDefault();

            setActivePane("models");

            return;
        }

        if (activePane === "providers") {
            const nextProviderIndex = modelPickerNavigationIndex(activeProviderIndex, groupedOptions.length, event.key);

            if (nextProviderIndex !== null) {
                event.preventDefault();

                activateProvider(nextProviderIndex);

                return;
            }

            if (event.key === "Enter") {
                event.preventDefault();

                setActivePane("models");
            }

            return;
        }

        const currentModelIndex = Math.max(0, selectedModels.indexOf(flatOptions[activeIndex]));

        const nextModelIndex = modelPickerNavigationIndex(currentModelIndex, selectedModels.length, event.key);

        if (nextModelIndex !== null) {
            event.preventDefault();

            setActiveIndex(optionIndexes.get(selectedModels[nextModelIndex]) || 0);

            return;
        }

        if (event.key === "Enter" && selectedModels.length) {
            event.preventDefault();

            onChange(selectedModels[Math.min(currentModelIndex, selectedModels.length - 1)]);

            closePicker();
        }
    };

    return (
        <Select
            open={open}

            value={current}

            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length && config.channelMode === "local") onMissingConfig?.();

                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));

                if (nextOpen) {
                    const currentChannelId = decodeChannelModel(current)?.channelId || groupedOptions[0]?.channelId || "";

                    const providerIndex = Math.max(
                        0,
                        groupedOptions.findIndex((group) => group.channelId === currentChannelId),
                    );

                    setSelectedChannelId(groupedOptions[providerIndex]?.channelId || "");

                    setActiveProviderIndex(providerIndex);

                    setActiveIndex(Math.max(0, flatOptions.indexOf(current)));

                    setActivePane("models");
                } else setQuery("");

                setOpen(nextOpen);
            }}

            onValueChange={onChange}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",

                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",

                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",

                    className,
                )}

                onMouseDown={(event) => event.stopPropagation()}

                onPointerDown={(event) => event.stopPropagation()}

                title={currentDetails ? [currentDetails.name, currentDetails.channelName, currentDetails.rawName].filter(Boolean).join(" · ") : pickerPlaceholder}
            >
                <ModelIcon model={current} />

                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelOptionLabel(config, current) : pickerPlaceholder}</span>
            </SelectTrigger>

            <SelectContent
                data-canvas-no-zoom

                className="z-[1200] !max-h-none w-[min(620px,calc(100vw-24px))] !overflow-y-hidden rounded-xl border border-border/70 bg-popover p-1 shadow-xl [&_[data-slot=select-scroll-down-button]]:hidden [&_[data-slot=select-scroll-up-button]]:hidden"

                position="popper"

                align="start"

                side="bottom"

                sideOffset={6}

                onPointerDown={(event) => event.stopPropagation()}

                onMouseDown={(event) => event.stopPropagation()}

                id={`${pickerId}-model-listbox`}
            >
                {options.length ? (
                    <>
                        <div className="sticky top-0 z-10 bg-popover p-1.5" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
                            <label className="flex h-9 items-center gap-2 rounded-lg border border-border/70 bg-background/70 px-2.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
                                <Search className="size-4 shrink-0 text-muted-foreground" />

                                <input
                                    ref={searchRef}

                                    value={query}

                                    onChange={(event) => {
                                        setQuery(event.target.value);

                                        setActiveIndex(0);
                                    }}

                                    onKeyDown={handleKeyboard}

                                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"

                                    placeholder={t("settingsPanels.model.search")}

                                    aria-label={t("settingsPanels.model.search")}

                                    role="combobox"

                                    aria-autocomplete="list"

                                    aria-expanded={open}

                                    aria-controls={`${pickerId}-model-listbox`}

                                    aria-activedescendant={
                                        activePane === "providers" && groupedOptions.length
                                            ? `${pickerId}-provider-option-${Math.min(activeProviderIndex, groupedOptions.length - 1)}`
                                            : flatOptions.length
                                              ? `${pickerId}-model-option-${Math.min(activeIndex, flatOptions.length - 1)}`
                                              : undefined
                                    }
                                />
                            </label>
                        </div>

                        {groupedOptions.length && selectedGroup ? (
                            <div className="model-picker-layout grid min-h-56 grid-cols-[13rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-border/60 bg-background/35">
                                <div
                                    className="model-picker-providers border-r border-border/60 bg-muted/25 p-1.5"
                                    role="listbox"
                                    aria-label={t("settingsPanels.model.providersColumn")}
                                    data-active-pane={activePane === "providers" ? "true" : undefined}
                                >
                                    <div className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("settingsPanels.model.providersColumn")}</div>

                                    {groupedOptions.map((group, index) => (
                                        <button
                                            key={group.channelId}

                                            id={`${pickerId}-provider-option-${index}`}

                                            type="button"

                                            role="option"

                                            aria-selected={group.channelId === selectedGroup.channelId}

                                            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent aria-selected:bg-accent aria-selected:text-accent-foreground"

                                            data-provider-active={activePane === "providers" && activeProviderIndex === index ? "true" : undefined}

                                            onMouseDown={(event) => event.preventDefault()}

                                            onClick={() => activateProvider(index, true)}
                                        >
                                            <Building2 className="size-4 shrink-0 opacity-70" />

                                            <span className="min-w-0 flex-1 truncate">{group.name}</span>

                                            <span className="text-[11px] tabular-nums text-muted-foreground">{group.models.length}</span>

                                            <ChevronRight className="size-3.5 shrink-0 opacity-55" />
                                        </button>
                                    ))}
                                </div>

                                <div
                                    className="model-picker-models min-h-0 min-w-0 p-1.5"
                                    role="group"
                                    aria-label={t("settingsPanels.model.modelsColumn")}
                                    data-active-pane={activePane === "models" ? "true" : undefined}
                                >
                                    <div className="flex items-center justify-between gap-3 px-2 pb-1.5 pt-1">
                                        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("settingsPanels.model.modelsColumn")}</span>

                                        <span className="max-w-[70%] truncate text-[11px] text-muted-foreground">{selectedGroup.name}</span>
                                    </div>

                                    <div ref={modelScrollRef} className="model-picker-model-scroll max-h-72 overflow-y-auto pr-0.5">
                                        {selectedModels.map((model) => {
                                            const index = optionIndexes.get(model) || 0;

                                            return (
                                                <SelectItem
                                                    key={model}

                                                    id={`${pickerId}-model-option-${index}`}

                                                    value={model}

                                                    textValue={modelOptionLabel(config, model)}

                                                    data-model-active={activePane === "models" && activeIndex === index ? "true" : undefined}

                                                    className="data-[model-active=true]:bg-accent data-[model-active=true]:text-accent-foreground"

                                                    onPointerMove={() => {
                                                        setActivePane("models");

                                                        setActiveIndex(index);
                                                    }}
                                                >
                                                    <ModelLabel config={config} model={model} />
                                                </SelectItem>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <SelectItem value="__no_search_results__" disabled>
                                {t("settingsPanels.model.noSearchResults")}
                            </SelectItem>
                        )}
                    </>
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

export function modelPickerNavigationIndex(currentIndex: number, optionCount: number, key: string) {
    if (optionCount <= 0) return null;

    const boundedIndex = Math.max(0, Math.min(currentIndex, optionCount - 1));

    if (key === "ArrowDown") return (boundedIndex + 1) % optionCount;

    if (key === "ArrowUp") return (boundedIndex + optionCount - 1) % optionCount;

    if (key === "Home") return 0;

    if (key === "End") return optionCount - 1;

    return null;
}

export function modelPickerScrollTop(current: number, deltaY: number, maximum: number) {
    return Math.max(0, Math.min(Math.max(0, maximum), current + deltaY));
}

export function groupModelOptions(config: AiConfig, options: string[], query = "") {
    const normalizedQuery = query.trim().toLowerCase();

    const groups = new Map<string, { key: string; channelId: string; name: string; models: string[] }>();

    for (const model of options) {
        const details = modelOptionDetails(config, model);

        const decoded = decodeChannelModel(model);

        const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : undefined;

        const key =
            channel?.provider === "volcengine-ark"
                ? "volcengine"
                : channel?.provider === "apimart"
                  ? "apimart"
                  : channel?.provider === "runninghub"
                    ? "runninghub"
                    : channel?.apiFormat === "openai"
                      ? "openaiCompatible"
                      : channel
                        ? "custom"
                        : "local";

        const channelId = channel?.id || key;

        const channelName = channel?.name || i18n.t(`settingsPanels.model.groups.${key}`);

        const providerMatches = `${channelName} ${key}`.toLowerCase().includes(normalizedQuery);

        const modelMatches = `${modelOptionLabel(config, model)} ${details.rawName}`.toLowerCase().includes(normalizedQuery);

        if (normalizedQuery && !providerMatches && !modelMatches) continue;

        const group = groups.get(channelId) || { key, channelId, name: channelName, models: [] };

        group.models.push(model);

        groups.set(channelId, group);
    }

    const order = ["volcengine", "apimart", "runninghub", "openaiCompatible", "custom", "local"];

    return [...groups.values()].sort((left, right) => {
        const providerRank = order.indexOf(left.key) - order.indexOf(right.key);

        return providerRank || left.name.localeCompare(right.name, i18n.language);
    });
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability ? i18n.t(`settingsPanels.model.capabilities.${capability}`) : "";

    if (capability && config.models.length) return i18n.t("settingsPanels.model.assign", { capability: label });

    return config.models.length ? i18n.t("settingsPanels.model.noMatch", { capability: label }) : i18n.t("settingsPanels.model.addFirst");
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    const details = modelOptionDetails(config, model);

    return (
        <span className="flex min-w-0 items-center gap-2" title={details.rawName}>
            <ModelIcon model={model} />

            <span className="min-w-0">
                <span className="block truncate">{modelOptionLabel(config, model)}</span>

                {details.channelName ? <span className="block truncate text-[11px] text-muted-foreground">{details.channelName}</span> : null}
            </span>
        </span>
    );
}

function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));

    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();

    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";

    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";

    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";

    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";

    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";

    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";

    return "";
}
