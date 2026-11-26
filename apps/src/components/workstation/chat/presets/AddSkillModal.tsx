import { useMemo, useState } from "react";
import {
  Sparkles,
  ArrowRight,
  Loader2,
  FolderOpen,
  CheckCircle2,
  Film,
  Trash2,
  Lock,
  Layers,
  Search,
} from "lucide-react";
import { Dialog, DialogContent } from "../../../ui/dialog";
import { API_BASE, apiFetch } from "../../../../lib/api";
import { cn } from "../../../../lib/utils";
import { toast } from "sonner";

export interface RegisteredSkillSummary {
  id: string;
  name: string;
  command: string;
  description: string;
  hasKit?: boolean;
  builtin?: boolean;
  origin?: string;
  deletable?: boolean;
  sourceVideo?: string;
}

interface AddSkillModalProps {
  open: boolean;
  onClose: () => void;
  skills: RegisteredSkillSummary[];
  onSkillRegistered: (command: string) => void;
  onSkillsChanged: () => void;
  onStartReferenceSkill?: (prompt: string) => void;
}

type ModalTab = "reference" | "import" | "manage";

function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function originLabel(origin?: string, builtin?: boolean): string {
  if (builtin || origin === "builtin") return "Built-in";
  if (origin === "reference") return "Referensi";
  if (origin === "imported") return "Import";
  return "Kustom";
}

export function AddSkillModal({
  open,
  onClose,
  skills,
  onSkillRegistered,
  onSkillsChanged,
  onStartReferenceSkill,
}: AddSkillModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>("reference");

  // Tab 1: Reference-to-Skill
  const [refSource, setRefSource] = useState("");
  const [refSkillName, setRefSkillName] = useState("");
  const [refNotes, setRefNotes] = useState("");

  // Tab 2: Import Package / SKILL.md
  const [name, setName] = useState("");
  const [filePath, setFilePath] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Tab 3: Manage / Delete Skills
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const cleanSlug = normalizeSlug(name);
  const cleanRefSlug = normalizeSlug(refSkillName);

  const customCount = useMemo(
    () => skills.filter((s) => s.deletable === true).length,
    [skills]
  );

  const filteredSkills = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const sorted = [...skills].sort((a, b) => {
      const aCustom = a.deletable ? 0 : 1;
      const bCustom = b.deletable ? 0 : 1;
      if (aCustom !== bCustom) return aCustom - bCustom;
      return a.id.localeCompare(b.id);
    });
    if (!q) return sorted;
    return sorted.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
    );
  }, [skills, searchQuery]);

  const handleStartFromReference = () => {
    const source = refSource.trim();
    if (!source) {
      toast.error("Masukkan path video referensi (.mp4) atau tautan video terlebih dahulu");
      return;
    }
    const slugHint = cleanRefSlug ? ` dengan calon nama skill \`/${cleanRefSlug}\`` : "";
    const extraNote = refNotes.trim() ? ` Catatan gaya/topik: ${refNotes.trim()}.` : "";
    const prompt =
      `Analisis video referensi ini (${source}) dan buat video sekaligus calon skill gaya deklaratif baru${slugHint} di folder draft proyek dulu (` +
      `pisahkan Style Craft Kit \`kit.js\` + \`kit.json\` + \`SKILL.md\` dan \`story.json\`, cek Component Gallery QC \`assets/kit-gallery.jpg\` terhadap crop referensi sebelum menyusun seluruh adegan). ` +
      `Setelah preview selesai, minta persetujuan saya lewat \`question\` apakah mau disimpan permanen jadi skill, simpan videonya saja, atau hapus draft-nya.${extraNote}`;

    onStartReferenceSkill?.(prompt);
    setRefSource("");
    setRefSkillName("");
    setRefNotes("");
    onClose();
  };

  const handleRegisterImport = async () => {
    if (!cleanSlug) {
      toast.error("Nama skill wajib diisi");
      return;
    }
    if (!filePath.trim()) {
      toast.error("Path folder paket skill atau file SKILL.md wajib diisi");
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/skills/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cleanSlug,
          file_path: filePath.trim(),
          description: description.trim() || undefined,
          origin: "imported",
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        skill?: { command?: string };
      };
      if (res.ok && data.success) {
        const cmd = data.skill?.command || `/${cleanSlug}`;
        toast.success(`Skill ${cmd} berhasil didaftarkan ke .aetheria/skills/`);
        onSkillRegistered(cmd);
        onSkillsChanged();
        onClose();
        setName("");
        setFilePath("");
        setDescription("");
      } else {
        toast.error(data.error || "Gagal mendaftarkan skill");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Koneksi ke engine gagal";
      toast.error(`Error: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSkill = async (skillId: string) => {
    setDeletingId(skillId);
    try {
      const res = await apiFetch(`${API_BASE}/skills/${encodeURIComponent(skillId)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (res.ok && data.success) {
        toast.success(`Skill /${skillId} berhasil dihapus.`);
        setConfirmDeleteId(null);
        onSkillsChanged();
      } else {
        toast.error(data.error || `Gagal menghapus skill /${skillId}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Koneksi ke engine gagal";
      toast.error(`Error: ${msg}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        onClose={onClose}
        className="max-w-xl rounded-[var(--radius-panel)] border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] transition-all duration-150"
      >
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="space-y-1 pr-6">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[var(--radius-pill)] bg-[var(--bg-panel)] border border-[var(--border-color)] text-[10px] font-mono text-[var(--text-secondary)]">
              <Sparkles size={11} className="text-[var(--status-warn-bar)]" />
              <span>/add skill</span>
              <span>•</span>
              <span>Skill Manager</span>
            </div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Kelola & Buat Skill Motion
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Buat skill gaya baru langsung dari video referensi (dengan persetujuan sebelum disimpan), import paket skill deklaratif, atau hapus skill kustom di{" "}
              <code className="text-[var(--text-primary)] font-mono">.aetheria/skills/</code>.
            </p>
          </div>

          {/* Segmented Pill Tabs */}
          <div
            role="tablist"
            aria-label="Mode Skill Manager"
            className="grid grid-cols-3 gap-1 p-1 rounded-[var(--radius-pill)] bg-[var(--bg-panel)] border border-[var(--border-color)]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "reference"}
              onClick={() => setActiveTab("reference")}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-pill)] transition-colors cursor-pointer",
                activeTab === "reference"
                  ? "bg-[var(--btn-primary-bg)] text-[color:var(--btn-primary-text)] border border-[var(--btn-primary-border)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              )}
            >
              <Film size={12} />
              <span>Dari Referensi</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "import"}
              onClick={() => setActiveTab("import")}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-pill)] transition-colors cursor-pointer",
                activeTab === "import"
                  ? "bg-[var(--btn-primary-bg)] text-[color:var(--btn-primary-text)] border border-[var(--btn-primary-border)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              )}
            >
              <FolderOpen size={12} />
              <span>Import Paket</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "manage"}
              onClick={() => setActiveTab("manage")}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-pill)] transition-colors cursor-pointer",
                activeTab === "manage"
                  ? "bg-[var(--btn-primary-bg)] text-[color:var(--btn-primary-text)] border border-[var(--btn-primary-border)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              )}
            >
              <Layers size={12} />
              <span>Kelola ({skills.length})</span>
            </button>
          </div>

          {/* Tab 1: Reference-to-Skill */}
          {activeTab === "reference" && (
            <div className="space-y-3.5">
              <div className="rounded-[var(--radius-card)] bg-[var(--bg-panel)] border border-[var(--border-color)] p-3 text-xs text-[var(--text-secondary)] leading-relaxed">
                Agent akan mengekstrak gaya visual referensi, menyusun <code className="font-mono text-[var(--text-primary)]">kit.js</code> + lembar QC galeri komponen di folder draft proyek, lalu meminta persetujuan Anda sebelum menyimpannya sebagai skill permanen.
              </div>

              <div className="space-y-1">
                <label htmlFor="ref-skill-source" className="text-xs font-medium text-[var(--text-primary)]">
                  Path Video Referensi (.mp4) atau Tautan
                </label>
                <input
                  id="ref-skill-source"
                  type="text"
                  value={refSource}
                  onChange={(e) => setRefSource(e.target.value)}
                  placeholder="contoh: ref/ref_pinterest.mp4 atau https://pin.it/..."
                  className="w-full px-3 py-2 text-xs rounded-[var(--radius-control)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-strong)] font-mono transition-colors"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="ref-skill-name" className="text-xs font-medium text-[var(--text-primary)] flex items-center justify-between">
                  <span>Nama Calon Skill (Opsional)</span>
                  {cleanRefSlug && (
                    <span className="font-mono text-[10px] text-[var(--text-secondary)]">/{cleanRefSlug}</span>
                  )}
                </label>
                <input
                  id="ref-skill-name"
                  type="text"
                  value={refSkillName}
                  onChange={(e) => setRefSkillName(e.target.value)}
                  placeholder="contoh: cobalt-editorial, paper-diorama..."
                  className="w-full px-3 py-2 text-xs rounded-[var(--radius-control)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-strong)] transition-colors"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="ref-skill-notes" className="text-xs font-medium text-[var(--text-primary)]">
                  Catatan Topik / Gaya (Opsional)
                </label>
                <input
                  id="ref-skill-notes"
                  type="text"
                  value={refNotes}
                  onChange={(e) => setRefNotes(e.target.value)}
                  placeholder="contoh: tanpa audio, fokus kartu editorial 9:16"
                  className="w-full px-3 py-2 text-xs rounded-[var(--radius-control)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-strong)] transition-colors"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-color)]">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-control)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleStartFromReference}
                  disabled={!refSource.trim() || !onStartReferenceSkill}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-[var(--radius-control)] transition-colors",
                    !refSource.trim() || !onStartReferenceSkill
                      ? "bg-[var(--bg-panel-sub)] text-[var(--text-muted)] cursor-not-allowed"
                      : "bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[color:var(--btn-primary-text)] border border-[var(--btn-primary-border)] cursor-pointer"
                  )}
                >
                  <Sparkles size={13} />
                  <span>Mulai Buat dari Referensi</span>
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          )}

          {/* Tab 2: Import Skill Package / SKILL.md */}
          {activeTab === "import" && (
            <div className="space-y-3.5">
              <div className="space-y-1">
                <label htmlFor="import-skill-name" className="text-xs font-medium text-[var(--text-primary)] flex items-center justify-between">
                  <span>Nama Skill</span>
                  {cleanSlug && (
                    <span className="font-mono text-[10px] text-[var(--text-secondary)]">/{cleanSlug}</span>
                  )}
                </label>
                <input
                  id="import-skill-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="contoh: paperworld, editorial-kinetic, cyber-neon..."
                  className="w-full px-3 py-2 text-xs rounded-[var(--radius-control)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-strong)] transition-colors"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="import-skill-path" className="text-xs font-medium text-[var(--text-primary)]">
                  Path Folder Paket Skill atau File SKILL.md
                </label>
                <div className="relative flex items-center">
                  <input
                    id="import-skill-path"
                    type="text"
                    value={filePath}
                    onChange={(e) => setFilePath(e.target.value)}
                    placeholder="contoh: E:/skills/my-kit/ atau E:/skills/my-kit/SKILL.md"
                    className="w-full pl-3 pr-8 py-2 text-xs rounded-[var(--radius-control)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-strong)] transition-colors font-mono"
                  />
                  <FolderOpen size={14} className="absolute right-3 text-[var(--text-muted)] pointer-events-none" />
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Jika menunjuk ke folder berisi <code className="font-mono">SKILL.md</code> + <code className="font-mono">examples/kit.json</code> + <code className="font-mono">examples/script/*.js</code>, seluruh paket disalin utuh.
                </p>
              </div>

              <div className="space-y-1">
                <label htmlFor="import-skill-desc" className="text-xs font-medium text-[var(--text-primary)]">
                  Deskripsi Singkat (Opsional)
                </label>
                <input
                  id="import-skill-desc"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Deskripsi singkat gaya visual dan animasi skill"
                  className="w-full px-3 py-2 text-xs rounded-[var(--radius-control)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-strong)] transition-colors"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-color)]">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isLoading}
                  className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-control)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleRegisterImport}
                  disabled={isLoading || !cleanSlug || !filePath.trim()}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-[var(--radius-control)] transition-colors",
                    isLoading || !cleanSlug || !filePath.trim()
                      ? "bg-[var(--bg-panel-sub)] text-[var(--text-muted)] cursor-not-allowed"
                      : "bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-hover)] text-[color:var(--btn-primary-text)] border border-[var(--btn-primary-border)] cursor-pointer"
                  )}
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Mendaftarkan...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={13} />
                      <span>Daftarkan ke .aetheria</span>
                      <ArrowRight size={13} />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Tab 3: Manage Skills (Built-in protected vs Custom deletable) */}
          {activeTab === "manage" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari skill..."
                    aria-label="Cari skill"
                    className="w-full pl-8 pr-3 py-1.5 text-xs rounded-[var(--radius-control)] bg-[var(--bg-input)] border border-[var(--border-color)] text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none focus:border-[var(--border-strong)]"
                  />
                </div>
                <span className="text-[11px] font-mono text-[var(--text-muted)] shrink-0">
                  {customCount} kustom • {skills.length - customCount} bawaan
                </span>
              </div>

              <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
                {filteredSkills.length === 0 ? (
                  <div className="rounded-[var(--radius-card)] border border-[var(--border-color)] bg-[var(--bg-panel)] p-4 text-center text-xs text-[var(--text-muted)]">
                    Tidak ada skill yang cocok dengan pencarian.
                  </div>
                ) : (
                  filteredSkills.map((skill) => {
                    const isDeletable = skill.deletable === true;
                    const isConfirming = confirmDeleteId === skill.id;
                    const isDeleting = deletingId === skill.id;

                    return (
                      <div
                        key={skill.id}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-[var(--radius-card)] bg-[var(--bg-panel)] border border-[var(--border-color)]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-mono font-medium text-[var(--text-primary)] truncate">
                              {skill.command}
                            </span>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-[var(--radius-pill)] border",
                                isDeletable
                                  ? "bg-[var(--bg-card)] border-[var(--border-strong)] text-[var(--text-primary)]"
                                  : "bg-[var(--bg-panel-sub)] border-[var(--border-color)] text-[var(--text-muted)]"
                              )}
                            >
                              {!isDeletable && <Lock size={9} />}
                              <span>{originLabel(skill.origin, skill.builtin)}</span>
                            </span>
                            {skill.hasKit && (
                              <span className="px-1.5 py-0.5 text-[10px] font-mono rounded-[var(--radius-pill)] bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-secondary)]">
                                kit
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--text-secondary)] truncate mt-0.5">
                            {skill.description}
                          </p>
                        </div>

                        <div className="shrink-0 flex items-center gap-1.5">
                          {isDeletable ? (
                            isConfirming ? (
                              <>
                                <button
                                  type="button"
                                  disabled={isDeleting}
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1 text-[11px] rounded-[var(--radius-control)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] cursor-pointer"
                                >
                                  Batal
                                </button>
                                <button
                                  type="button"
                                  disabled={isDeleting}
                                  onClick={() => handleDeleteSkill(skill.id)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-[var(--radius-control)] bg-[var(--status-error-bg)] text-white hover:opacity-90 cursor-pointer"
                                >
                                  {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                                  <span>Hapus</span>
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                aria-label={`Hapus skill ${skill.command}`}
                                onClick={() => setConfirmDeleteId(skill.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-[var(--radius-control)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--status-error-border)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
                              >
                                <Trash2 size={11} />
                                <span>Hapus</span>
                              </button>
                            )
                          ) : (
                            <span
                              title="Skill bawaan dilindungi"
                              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded-[var(--radius-pill)] text-[var(--text-muted)]"
                            >
                              <Lock size={10} />
                              <span>Terkunci</span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex items-center justify-end pt-2 border-t border-[var(--border-color)]">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-control)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] transition-colors cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
