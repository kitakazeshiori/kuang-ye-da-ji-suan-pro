// 快照式撤销/重做。快照是 JSON 字符串，容量按条数与字节数双重限制。
export class History {
  constructor(limit = 60, maxBytes = 24 * 1024 * 1024) {
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.entries = [];
    this.index = -1;
    this.bytes = 0;
  }

  reset(snapshot, label = "初始状态") {
    this.entries = [{ snapshot, label }];
    this.index = 0;
    this.bytes = snapshot.length;
  }

  push(snapshot, label = "") {
    if (this.index < this.entries.length - 1) {
      for (let i = this.index + 1; i < this.entries.length; i++) this.bytes -= this.entries[i].snapshot.length;
      this.entries.length = this.index + 1;
    }
    this.entries.push({ snapshot, label });
    this.bytes += snapshot.length;
    this.index = this.entries.length - 1;
    while (this.entries.length > this.limit || (this.bytes > this.maxBytes && this.entries.length > 2)) {
      this.bytes -= this.entries[0].snapshot.length;
      this.entries.shift();
      this.index--;
    }
  }

  undo() {
    if (this.index <= 0) return null;
    this.index--;
    return this.entries[this.index].snapshot;
  }

  redo() {
    if (this.index >= this.entries.length - 1) return null;
    this.index++;
    return this.entries[this.index].snapshot;
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index < this.entries.length - 1;
  }

  get undoLabel() {
    return this.canUndo ? this.entries[this.index].label : "";
  }

  get redoLabel() {
    return this.canRedo ? this.entries[this.index + 1].label : "";
  }
}