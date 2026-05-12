// Shared state union for components that toggle between view / edit / confirm-delete.
// Used by both CommentCard and WorkspacePicker.Entry to keep the state-machine names aligned.
export type EditableItemMode = "view" | "edit" | "confirmDelete";
