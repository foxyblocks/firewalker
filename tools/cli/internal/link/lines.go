package link

import "strings"

// maxLine caps a line with no ending, so garbage on the port can't grow a buffer forever.
// The longest real reply, a status line, is well under this.
const maxLine = 4096

// LineSplitter is an io.Writer that calls emit once per complete line. Either \n or \r
// ends a line, because a build's progress output rewrites one line with bare \r, and
// that should read as a series of lines rather than one enormous one. Blank lines are
// skipped, which also covers the empty line between the two bytes of a \r\n.
type LineSplitter struct {
	emit    func(string)
	pending strings.Builder
}

// NewLineSplitter returns a splitter that hands each complete line to emit.
func NewLineSplitter(emit func(string)) *LineSplitter { return &LineSplitter{emit: emit} }

// Write never fails, so it can sit directly behind a child process's output.
func (s *LineSplitter) Write(data []byte) (int, error) {
	for _, b := range data {
		if b == '\n' || b == '\r' {
			s.flush()
			continue
		}
		s.pending.WriteByte(b)
		if s.pending.Len() >= maxLine {
			s.flush()
		}
	}
	return len(data), nil
}

// Flush delivers whatever is left over, for output that ends without a line ending.
func (s *LineSplitter) Flush() { s.flush() }

func (s *LineSplitter) flush() {
	if s.pending.Len() > 0 {
		s.emit(s.pending.String())
		s.pending.Reset()
	}
}
