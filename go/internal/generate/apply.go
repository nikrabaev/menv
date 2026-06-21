package generate

import (
	"os"
	"path/filepath"

	"github.com/nikrabaev/menv/go/internal/core"
	menvio "github.com/nikrabaev/menv/go/internal/io"
)

// ApplyFileOp applies a release or delete FileOp under the ownership rule.
// "write" ops are handled by ApplyPreview (which already carries the content).
// Files without the marker or missing files are left untouched.
func ApplyFileOp(root string, op core.FileOp) error {
	if op.Action == "write" {
		return nil
	}
	abs := filepath.Join(root, op.Path)
	data, err := os.ReadFile(abs)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !HasOwnershipMarker(string(data)) {
		return nil
	}
	if op.Action == "release" {
		stripped := StripDisclaimer(string(data))
		return menvio.WriteFileAtomic(root, op.Path, []byte(stripped))
	}
	// delete
	return os.Remove(abs)
}

// ApplyPreview writes all files in the preview to disk.
func ApplyPreview(root string, preview GeneratePreview) error {
	for _, w := range preview.Writes {
		if err := menvio.WriteFileAtomic(root, w.Path, []byte(w.Content)); err != nil {
			return err
		}
	}
	return nil
}
