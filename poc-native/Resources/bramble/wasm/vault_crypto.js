/* @ts-self-types="./vault_crypto.d.ts" */

/**
 * Opens one sealed blob chunk by chunk, in order. Call `free()` when done.
 */
export class FileOpenStream {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    FileOpenStreamFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_fileopenstream_free(ptr, 0);
  }
  /**
   * Unwrap the file's key under the VEK in the slot now. `sealed_len` is the blob's
   * length, a number rather than a BigInt so JS can pass a size as it has one.
   * @param {string} wrapped_fek_b64
   * @param {string} fek_iv_b64
   * @param {string} nonce_prefix_b64
   * @param {number} sealed_len
   */
  constructor(wrapped_fek_b64, fek_iv_b64, nonce_prefix_b64, sealed_len) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passStringToWasm0(
        wrapped_fek_b64,
        wasm.__wbindgen_export,
        wasm.__wbindgen_export2,
      );
      const len0 = WASM_VECTOR_LEN;
      const ptr1 = passStringToWasm0(
        fek_iv_b64,
        wasm.__wbindgen_export,
        wasm.__wbindgen_export2,
      );
      const len1 = WASM_VECTOR_LEN;
      const ptr2 = passStringToWasm0(
        nonce_prefix_b64,
        wasm.__wbindgen_export,
        wasm.__wbindgen_export2,
      );
      const len2 = WASM_VECTOR_LEN;
      wasm.fileopenstream_new(
        retptr,
        ptr0,
        len0,
        ptr1,
        len1,
        ptr2,
        len2,
        sealed_len,
      );
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      this.__wbg_ptr = r0;
      FileOpenStreamFinalization.register(this, this.__wbg_ptr, this);
      return this;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
   * `[offset, length]` of the next chunk to read, or undefined once every chunk is open.
   * @returns {Float64Array | undefined}
   */
  next_range() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.fileopenstream_next_range(retptr, this.__wbg_ptr);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      let v1;
      if (r0 !== 0) {
        v1 = getArrayF64FromWasm0(r0, r1).slice();
        wasm.__wbindgen_export4(r0, r1 * 8, 8);
      }
      return v1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
   * Open the next chunk. `sealed` must be exactly the range `next_range` named.
   * @param {Uint8Array} sealed
   * @returns {Uint8Array}
   */
  open_next(sealed) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(sealed, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      wasm.fileopenstream_open_next(retptr, this.__wbg_ptr, ptr0, len0);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
      if (r3) {
        throw takeObject(r2);
      }
      var v2 = getArrayU8FromWasm0(r0, r1).slice();
      wasm.__wbindgen_export4(r0, r1 * 1, 1);
      return v2;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
   * The file's length once open, known before any chunk is: what a KDBX attachment
   * declares ahead of its bytes.
   * @returns {number}
   */
  plaintext_len() {
    const ret = wasm.fileopenstream_plaintext_len(this.__wbg_ptr);
    return ret;
  }
}
if (Symbol.dispose)
  FileOpenStream.prototype[Symbol.dispose] = FileOpenStream.prototype.free;

/**
 * Seals one file as its chunks are fed in. Call `free()` when done, finished or not: that
 * zeroizes the content key.
 */
export class FileSealStream {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    FileSealStreamFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_filesealstream_free(ptr, 0);
  }
  /**
   * The record's fields. Once only, and only after the last chunk.
   * @returns {any}
   */
  finish() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.filesealstream_finish(retptr, this.__wbg_ptr);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return takeObject(r0);
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
   * Generate the file's key and seal `meta_json`, under the VEK in the slot now.
   * @param {string} meta_json
   */
  constructor(meta_json) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passStringToWasm0(
        meta_json,
        wasm.__wbindgen_export,
        wasm.__wbindgen_export2,
      );
      const len0 = WASM_VECTOR_LEN;
      wasm.filesealstream_new(retptr, ptr0, len0);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      this.__wbg_ptr = r0;
      FileSealStreamFinalization.register(this, this.__wbg_ptr, this);
      return this;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
   * Seal the next chunk: exactly CHUNK_LEN bytes unless it is the last.
   * @param {Uint8Array} plaintext
   * @param {boolean} is_last
   * @returns {Uint8Array}
   */
  seal_next(plaintext, is_last) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(plaintext, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      wasm.filesealstream_seal_next(
        retptr,
        this.__wbg_ptr,
        ptr0,
        len0,
        is_last,
      );
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
      if (r3) {
        throw takeObject(r2);
      }
      var v2 = getArrayU8FromWasm0(r0, r1).slice();
      wasm.__wbindgen_export4(r0, r1 * 1, 1);
      return v2;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
}
if (Symbol.dispose)
  FileSealStream.prototype[Symbol.dispose] = FileSealStream.prototype.free;

/**
 * The writer, for JS: attachments streamed in from the vault's store, the file streamed out.
 */
export class KdbxWriter {
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr;
    this.__wbg_ptr = 0;
    KdbxWriterFinalization.unregister(this);
    return ptr;
  }
  free() {
    const ptr = this.__destroy_into_raw();
    wasm.__wbg_kdbxwriter_free(ptr, 0);
  }
  /**
   * `len` as a number rather than a BigInt, since JS has a size as one.
   * @param {number} len
   * @returns {number}
   */
  begin_binary(len) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.kdbxwriter_begin_binary(retptr, this.__wbg_ptr, len);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      return r0 >>> 0;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
   * `entries` as `SaveEntry` objects, binaries referring to the indices handed out above.
   * @param {any} entries
   * @returns {Uint8Array}
   */
  finish(entries) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.kdbxwriter_finish(retptr, this.__wbg_ptr, addHeapObject(entries));
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
      if (r3) {
        throw takeObject(r2);
      }
      var v1 = getArrayU8FromWasm0(r0, r1).slice();
      wasm.__wbindgen_export4(r0, r1 * 1, 1);
      return v1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
   * @param {string} password
   */
  constructor(password) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passStringToWasm0(
        password,
        wasm.__wbindgen_export,
        wasm.__wbindgen_export2,
      );
      const len0 = WASM_VECTOR_LEN;
      wasm.kdbxwriter_new(retptr, ptr0, len0);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      if (r2) {
        throw takeObject(r1);
      }
      this.__wbg_ptr = r0;
      KdbxWriterFinalization.register(this, this.__wbg_ptr, this);
      return this;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
   * @returns {Uint8Array}
   */
  take() {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      wasm.kdbxwriter_take(retptr, this.__wbg_ptr);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
      var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
      if (r3) {
        throw takeObject(r2);
      }
      var v1 = getArrayU8FromWasm0(r0, r1).slice();
      wasm.__wbindgen_export4(r0, r1 * 1, 1);
      return v1;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
  /**
   * @param {Uint8Array} bytes
   */
  write_binary(bytes) {
    try {
      const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
      const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_export);
      const len0 = WASM_VECTOR_LEN;
      wasm.kdbxwriter_write_binary(retptr, this.__wbg_ptr, ptr0, len0);
      var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
      var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
      if (r1) {
        throw takeObject(r0);
      }
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  }
}
if (Symbol.dispose)
  KdbxWriter.prototype[Symbol.dispose] = KdbxWriter.prototype.free;

/**
 * Open many entries in one call; failed entries come back as null.
 * @param {any} entries
 * @returns {any}
 */
export function decrypt_entries(entries) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.decrypt_entries(retptr, addHeapObject(entries));
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Decrypt an entry: VEK unwraps the DEK, the DEK decrypts the plaintext.
 * @param {string} ciphertext
 * @param {string} iv
 * @param {string} wrapped_dek
 * @param {string} dek_iv
 * @returns {string}
 */
export function decrypt_entry(ciphertext, iv, wrapped_dek, dek_iv) {
  let deferred6_0;
  let deferred6_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      ciphertext,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      iv,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      wrapped_dek,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(
      dek_iv,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len3 = WASM_VECTOR_LEN;
    wasm.decrypt_entry(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr5 = r0;
    var len5 = r1;
    if (r3) {
      ptr5 = 0;
      len5 = 0;
      throw takeObject(r2);
    }
    deferred6_0 = ptr5;
    deferred6_1 = len5;
    return getStringFromWasm0(ptr5, len5);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred6_0, deferred6_1, 1);
  }
}

/**
 * Decrypt ciphertext encrypted directly under the VEK.
 * @param {string} iv_b64
 * @param {string} ciphertext_b64
 * @returns {string}
 */
export function decrypt_with_vek(iv_b64, ciphertext_b64) {
  let deferred4_0;
  let deferred4_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      iv_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      ciphertext_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    wasm.decrypt_with_vek(retptr, ptr0, len0, ptr1, len1);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr3 = r0;
    var len3 = r1;
    if (r3) {
      ptr3 = 0;
      len3 = 0;
      throw takeObject(r2);
    }
    deferred4_0 = ptr3;
    deferred4_1 = len3;
    return getStringFromWasm0(ptr3, len3);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred4_0, deferred4_1, 1);
  }
}

/**
 * Encrypt an entry: random DEK encrypts the plaintext, VEK wraps the DEK.
 * @param {string} plaintext_json
 * @returns {any}
 */
export function encrypt_entry(plaintext_json) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      plaintext_json,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.encrypt_entry(retptr, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Encrypt plaintext directly under the VEK (no per-item DEK).
 * @param {string} plaintext
 * @returns {any}
 */
export function encrypt_with_vek(plaintext) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      plaintext,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.encrypt_with_vek(retptr, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Return the in-memory VEK base64-encoded (for session caching). Errors if locked.
 * @returns {string}
 */
export function export_vek() {
  let deferred2_0;
  let deferred2_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.export_vek(retptr);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr1 = r0;
    var len1 = r1;
    if (r3) {
      ptr1 = 0;
      len1 = 0;
      throw takeObject(r2);
    }
    deferred2_0 = ptr1;
    deferred2_1 = len1;
    return getStringFromWasm0(ptr1, len1);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
  }
}

/**
 * Generate a random base64 salt for a password slot.
 * @returns {string}
 */
export function generate_salt() {
  let deferred2_0;
  let deferred2_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.generate_salt(retptr);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr1 = r0;
    var len1 = r1;
    if (r3) {
      ptr1 = 0;
      len1 = 0;
      throw takeObject(r2);
    }
    deferred2_0 = ptr1;
    deferred2_1 = len1;
    return getStringFromWasm0(ptr1, len1);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
  }
}

/**
 * Generate a random base64 slot id.
 * @returns {string}
 */
export function generate_slot_id() {
  let deferred2_0;
  let deferred2_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.generate_slot_id(retptr);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr1 = r0;
    var len1 = r1;
    if (r3) {
      ptr1 = 0;
      len1 = 0;
      throw takeObject(r2);
    }
    deferred2_0 = ptr1;
    deferred2_1 = len1;
    return getStringFromWasm0(ptr1, len1);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
  }
}

/**
 * Generate a fresh VEK at vault creation, load it into memory, and return it
 * base64-encoded.
 * @returns {string}
 */
export function generate_vek() {
  let deferred2_0;
  let deferred2_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.generate_vek(retptr);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr1 = r0;
    var len1 = r1;
    if (r3) {
      ptr1 = 0;
      len1 = 0;
      throw takeObject(r2);
    }
    deferred2_0 = ptr1;
    deferred2_1 = len1;
    return getStringFromWasm0(ptr1, len1);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
  }
}

/**
 * Drop a session and zero its keys.
 * @param {number} session_id
 */
export function handshake_close(session_id) {
  wasm.handshake_close(session_id);
}

/**
 * Decrypt an app message over an established session. Returns the plaintext.
 * @param {number} session_id
 * @param {string} ciphertext_b64
 * @returns {string}
 */
export function handshake_decrypt(session_id, ciphertext_b64) {
  let deferred3_0;
  let deferred3_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      ciphertext_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.handshake_decrypt(retptr, session_id, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr2 = r0;
    var len2 = r1;
    if (r3) {
      ptr2 = 0;
      len2 = 0;
      throw takeObject(r2);
    }
    deferred3_0 = ptr2;
    deferred3_1 = len2;
    return getStringFromWasm0(ptr2, len2);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred3_0, deferred3_1, 1);
  }
}

/**
 * Encrypt an app message over an established session. Returns base64 ciphertext.
 * @param {number} session_id
 * @param {string} plaintext
 * @returns {string}
 */
export function handshake_encrypt(session_id, plaintext) {
  let deferred3_0;
  let deferred3_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      plaintext,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.handshake_encrypt(retptr, session_id, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr2 = r0;
    var len2 = r1;
    if (r3) {
      ptr2 = 0;
      len2 = 0;
      throw takeObject(r2);
    }
    deferred3_0 = ptr2;
    deferred3_1 = len2;
    return getStringFromWasm0(ptr2, len2);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred3_0, deferred3_1, 1);
  }
}

/**
 * Begin enrollment as the joiner (initiator). `psk_b64` is the pairing secret from
 * the paste code. Returns the session id and the first message.
 * @param {string} local_priv_b64
 * @param {string} psk_b64
 * @returns {any}
 */
export function handshake_enroll_initiator(local_priv_b64, psk_b64) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      local_priv_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      psk_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    wasm.handshake_enroll_initiator(retptr, ptr0, len0, ptr1, len1);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Begin enrollment as the inviter (responder). Returns the session id.
 * @param {string} local_priv_b64
 * @param {string} psk_b64
 * @returns {number}
 */
export function handshake_enroll_responder(local_priv_b64, psk_b64) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      local_priv_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      psk_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    wasm.handshake_enroll_responder(retptr, ptr0, len0, ptr1, len1);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return r0 >>> 0;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Generate a device static X25519 keypair for enrollment. The private key must be
 * stored locally only; the public key goes in the roster.
 * @returns {any}
 */
export function handshake_generate_keypair() {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.handshake_generate_keypair(retptr);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * The handshake hash of a completed session, base64. Both ends of an untampered handshake agree.
 * @param {number} session_id
 * @returns {string}
 */
export function handshake_hash(session_id) {
  let deferred2_0;
  let deferred2_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.handshake_hash(retptr, session_id);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr1 = r0;
    var len1 = r1;
    if (r3) {
      ptr1 = 0;
      len1 = 0;
      throw takeObject(r2);
    }
    deferred2_0 = ptr1;
    deferred2_1 = len1;
    return getStringFromWasm0(ptr1, len1);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
  }
}

/**
 * @param {string} local_priv_b64
 * @returns {any}
 */
export function handshake_link_initiator(local_priv_b64) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      local_priv_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.handshake_link_initiator(retptr, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Answer a browser link handshake (desktop side). No uniffi export: phones never link.
 * @param {string} local_priv_b64
 * @returns {number}
 */
export function handshake_link_responder(local_priv_b64) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      local_priv_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.handshake_link_responder(retptr, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return r0 >>> 0;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Feed an incoming handshake message. Returns `{ message?, done }`.
 * @param {number} session_id
 * @param {string} message_b64
 * @returns {any}
 */
export function handshake_read(session_id, message_b64) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      message_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.handshake_read(retptr, session_id, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * The peer's static public key on a completed session, base64. The inviter uses
 * this to add the joiner to the roster.
 * @param {number} session_id
 * @returns {string}
 */
export function handshake_remote_static(session_id) {
  let deferred2_0;
  let deferred2_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.handshake_remote_static(retptr, session_id);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr1 = r0;
    var len1 = r1;
    if (r3) {
      ptr1 = 0;
      len1 = 0;
      throw takeObject(r2);
    }
    deferred2_0 = ptr1;
    deferred2_1 = len1;
    return getStringFromWasm0(ptr1, len1);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
  }
}

/**
 * Begin a handshake as initiator. Returns the session id and the first message.
 * @param {string} local_priv_b64
 * @param {string} remote_pub_b64
 * @returns {any}
 */
export function handshake_start_initiator(local_priv_b64, remote_pub_b64) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      local_priv_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      remote_pub_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    wasm.handshake_start_initiator(retptr, ptr0, len0, ptr1, len1);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Begin a handshake as responder. Returns the session id; awaits the first message.
 * @param {string} local_priv_b64
 * @param {string} remote_pub_b64
 * @returns {number}
 */
export function handshake_start_responder(local_priv_b64, remote_pub_b64) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      local_priv_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      remote_pub_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    wasm.handshake_start_responder(retptr, ptr0, len0, ptr1, len1);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return r0 >>> 0;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Whether the vault is locked (no VEK in memory).
 * @returns {boolean}
 */
export function is_locked() {
  const ret = wasm.is_locked();
  return ret !== 0;
}

/**
 * Clear the VEK from memory, locking the vault.
 */
export function lock() {
  wasm.lock();
}

/**
 * The group's mailbox id: 32 bytes from the VEK salted by the group key, base64url unpadded.
 * @param {string} group_key_b64
 * @returns {string}
 */
export function mailbox_id(group_key_b64) {
  let deferred3_0;
  let deferred3_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      group_key_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.mailbox_id(retptr, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr2 = r0;
    var len2 = r1;
    if (r3) {
      ptr2 = 0;
      len2 = 0;
      throw takeObject(r2);
    }
    deferred3_0 = ptr2;
    deferred3_1 = len2;
    return getStringFromWasm0(ptr2, len2);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred3_0, deferred3_1, 1);
  }
}

/**
 * Open a sealed message with the same `aad`; any mismatch or tampering is "mailbox open failed".
 * @param {string} group_key_b64
 * @param {string} aad
 * @param {string} sealed_b64
 * @returns {string}
 */
export function mailbox_open(group_key_b64, aad, sealed_b64) {
  let deferred5_0;
  let deferred5_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      group_key_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      aad,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      sealed_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    wasm.mailbox_open(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr4 = r0;
    var len4 = r1;
    if (r3) {
      ptr4 = 0;
      len4 = 0;
      throw takeObject(r2);
    }
    deferred5_0 = ptr4;
    deferred5_1 = len4;
    return getStringFromWasm0(ptr4, len4);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred5_0, deferred5_1, 1);
  }
}

/**
 * Seal `plaintext` for the group's mailbox, binding `aad`. Base64 out.
 * @param {string} group_key_b64
 * @param {string} aad
 * @param {string} plaintext
 * @returns {string}
 */
export function mailbox_seal(group_key_b64, aad, plaintext) {
  let deferred5_0;
  let deferred5_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      group_key_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      aad,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      plaintext,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    wasm.mailbox_seal(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr4 = r0;
    var len4 = r1;
    if (r3) {
      ptr4 = 0;
      len4 = 0;
      throw takeObject(r2);
    }
    deferred5_0 = ptr4;
    deferred5_1 = len4;
    return getStringFromWasm0(ptr4, len4);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred5_0, deferred5_1, 1);
  }
}

/**
 * Generate a Nostr secp256k1 keypair. Returns base64 secret + x-only public key.
 * @returns {any}
 */
export function nostr_generate_key() {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.nostr_generate_key(retptr);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * The x-only public key for a secret key, base64.
 * @param {string} secret_b64
 * @returns {string}
 */
export function nostr_public_key(secret_b64) {
  let deferred3_0;
  let deferred3_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      secret_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.nostr_public_key(retptr, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr2 = r0;
    var len2 = r1;
    if (r3) {
      ptr2 = 0;
      len2 = 0;
      throw takeObject(r2);
    }
    deferred3_0 = ptr2;
    deferred3_1 = len2;
    return getStringFromWasm0(ptr2, len2);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred3_0, deferred3_1, 1);
  }
}

/**
 * BIP340-sign a 32-byte event id (base64 in, base64 64-byte sig out).
 * @param {string} secret_b64
 * @param {string} hash_b64
 * @returns {string}
 */
export function nostr_sign(secret_b64, hash_b64) {
  let deferred4_0;
  let deferred4_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      secret_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      hash_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    wasm.nostr_sign(retptr, ptr0, len0, ptr1, len1);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr3 = r0;
    var len3 = r1;
    if (r3) {
      ptr3 = 0;
      len3 = 0;
      throw takeObject(r2);
    }
    deferred4_0 = ptr3;
    deferred4_1 = len3;
    return getStringFromWasm0(ptr3, len3);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred4_0, deferred4_1, 1);
  }
}

/**
 * Verify a BIP340 signature over a 32-byte event id.
 * @param {string} public_b64
 * @param {string} hash_b64
 * @param {string} sig_b64
 * @returns {boolean}
 */
export function nostr_verify(public_b64, hash_b64, sig_b64) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      public_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      hash_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      sig_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    wasm.nostr_verify(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return r0 !== 0;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Open a file's sealed metadata, returning the JSON that was sealed.
 * @param {string} wrapped_fek_b64
 * @param {string} fek_iv_b64
 * @param {string} meta_blob_b64
 * @param {string} meta_iv_b64
 * @returns {string}
 */
export function open_file_meta(
  wrapped_fek_b64,
  fek_iv_b64,
  meta_blob_b64,
  meta_iv_b64,
) {
  let deferred6_0;
  let deferred6_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      wrapped_fek_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      fek_iv_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      meta_blob_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(
      meta_iv_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len3 = WASM_VECTOR_LEN;
    wasm.open_file_meta(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr5 = r0;
    var len5 = r1;
    if (r3) {
      ptr5 = 0;
      len5 = 0;
      throw takeObject(r2);
    }
    deferred6_0 = ptr5;
    deferred6_1 = len5;
    return getStringFromWasm0(ptr5, len5);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred6_0, deferred6_1, 1);
  }
}

/**
 * WASM entry point. `keyfile` is the raw key-file bytes, if any. Returns
 * `{ entries, attachments }`, each attachment a `Uint8Array` the entries refer to by index.
 * @param {Uint8Array} file
 * @param {string} password
 * @param {Uint8Array | null} [keyfile]
 * @returns {any}
 */
export function open_kdbx4(file, password, keyfile) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(file, wasm.__wbindgen_export);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      password,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(keyfile)
      ? 0
      : passArray8ToWasm0(keyfile, wasm.__wbindgen_export);
    var len2 = WASM_VECTOR_LEN;
    wasm.open_kdbx4(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Open a portable vault. Returns the entries JSON, or null for a wrong password.
 * @param {string} password
 * @param {any} file
 * @param {Uint8Array} magic_version
 * @returns {string | undefined}
 */
export function open_portable_vault(password, file, magic_version) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      password,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(magic_version, wasm.__wbindgen_export);
    const len1 = WASM_VECTOR_LEN;
    wasm.open_portable_vault(
      retptr,
      ptr0,
      len0,
      addHeapObject(file),
      ptr1,
      len1,
    );
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    if (r3) {
      throw takeObject(r2);
    }
    let v3;
    if (r0 !== 0) {
      v3 = getStringFromWasm0(r0, r1).slice();
      wasm.__wbindgen_export4(r0, r1 * 1, 1);
    }
    return v3;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Assert a stored passkey: sign authenticatorData || clientDataHash with its key.
 * @param {string} rp_id
 * @param {string} private_key_b64
 * @param {number} alg
 * @param {string} client_data_hash_b64
 * @param {boolean} user_verified
 * @returns {any}
 */
export function passkey_get_assertion(
  rp_id,
  private_key_b64,
  alg,
  client_data_hash_b64,
  user_verified,
) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      rp_id,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      private_key_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      client_data_hash_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    wasm.passkey_get_assertion(
      retptr,
      ptr0,
      len0,
      ptr1,
      len1,
      alg,
      ptr2,
      len2,
      user_verified,
    );
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Convert a base64 PKCS#8 key into Bramble's stored secret, COSE public key, and alg.
 * @param {string} pkcs8_b64
 * @returns {any}
 */
export function passkey_import_pkcs8(pkcs8_b64) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      pkcs8_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.passkey_import_pkcs8(retptr, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Mint a passkey (provider role) for `rp_id`. Returns credentialId, COSE public
 * key, private key (to store in the entry), and the `none` attestation object.
 * @param {string} rp_id
 * @param {boolean} user_verified
 * @returns {any}
 */
export function passkey_make_credential(rp_id, user_verified) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      rp_id,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.passkey_make_credential(retptr, ptr0, len0, user_verified);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * WebAuthn PRF over a passkey's stored secret (see docs/passkey-prf.md).
 * @param {string} secret_b64
 * @param {string} first_b64
 * @param {string | null} [second_b64]
 * @returns {any}
 */
export function passkey_prf_eval(secret_b64, first_b64, second_b64) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      secret_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      first_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(second_b64)
      ? 0
      : passStringToWasm0(
          second_b64,
          wasm.__wbindgen_export,
          wasm.__wbindgen_export2,
        );
    var len2 = WASM_VECTOR_LEN;
    wasm.passkey_prf_eval(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Reseal a file's metadata under its existing FEK, for a rename.
 * @param {string} wrapped_fek_b64
 * @param {string} fek_iv_b64
 * @param {string} meta_json
 * @returns {any}
 */
export function reseal_file_meta(wrapped_fek_b64, fek_iv_b64, meta_json) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      wrapped_fek_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      fek_iv_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      meta_json,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    wasm.reseal_file_meta(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * This device's admission verify key (base64), derived from the master password + password-slot
 * salt, to publish in its roster entry so peers can verify who it admits.
 * @param {string} password
 * @param {string} salt_b64
 * @returns {string}
 */
export function roster_admission_public_key(password, salt_b64) {
  let deferred4_0;
  let deferred4_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      password,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      salt_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    wasm.roster_admission_public_key(retptr, ptr0, len0, ptr1, len1);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr3 = r0;
    var len3 = r1;
    if (r3) {
      ptr3 = 0;
      len3 = 0;
      throw takeObject(r2);
    }
    deferred4_0 = ptr3;
    deferred4_1 = len3;
    return getStringFromWasm0(ptr3, len3);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred4_0, deferred4_1, 1);
  }
}

/**
 * Admission-sign an admitted device's canonical roster entry with THIS device's password-derived
 * admission key. Requires a fresh password entry; the key is derived transiently and dropped.
 * @param {string} password
 * @param {string} salt_b64
 * @param {string} message
 * @returns {string}
 */
export function roster_admission_sign(password, salt_b64, message) {
  let deferred5_0;
  let deferred5_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      password,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      salt_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      message,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    wasm.roster_admission_sign(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr4 = r0;
    var len4 = r1;
    if (r3) {
      ptr4 = 0;
      len4 = 0;
      throw takeObject(r2);
    }
    deferred5_0 = ptr4;
    deferred5_1 = len4;
    return getStringFromWasm0(ptr4, len4);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred5_0, deferred5_1, 1);
  }
}

/**
 * Generate an Ed25519 device keypair. Returns base64 secret seed + verify key.
 * @returns {any}
 */
export function roster_sig_generate_key() {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.roster_sig_generate_key(retptr);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * The Ed25519 verify key for a secret seed, base64.
 * @param {string} secret_b64
 * @returns {string}
 */
export function roster_sig_public_key(secret_b64) {
  let deferred3_0;
  let deferred3_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      secret_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.roster_sig_public_key(retptr, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr2 = r0;
    var len2 = r1;
    if (r3) {
      ptr2 = 0;
      len2 = 0;
      throw takeObject(r2);
    }
    deferred3_0 = ptr2;
    deferred3_1 = len2;
    return getStringFromWasm0(ptr2, len2);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred3_0, deferred3_1, 1);
  }
}

/**
 * Ed25519-sign the canonical roster-entry string (its UTF-8 bytes). Base64 secret in, base64
 * 64-byte signature out. `message` is `canonicalRosterEntry(entry)` verbatim.
 * @param {string} secret_b64
 * @param {string} message
 * @returns {string}
 */
export function roster_sign(secret_b64, message) {
  let deferred4_0;
  let deferred4_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      secret_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      message,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    wasm.roster_sign(retptr, ptr0, len0, ptr1, len1);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr3 = r0;
    var len3 = r1;
    if (r3) {
      ptr3 = 0;
      len3 = 0;
      throw takeObject(r2);
    }
    deferred4_0 = ptr3;
    deferred4_1 = len3;
    return getStringFromWasm0(ptr3, len3);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred4_0, deferred4_1, 1);
  }
}

/**
 * Verify an Ed25519 signature over the canonical roster-entry string.
 * @param {string} public_b64
 * @param {string} message
 * @param {string} sig_b64
 * @returns {boolean}
 */
export function roster_verify(public_b64, message, sig_b64) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      public_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      message,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      sig_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    wasm.roster_verify(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return r0 !== 0;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Generate a fresh VEK and replace the in-memory one (caller must re-wrap every
 * slot). Refuses to run on a locked vault to avoid dropping the old key material.
 * @returns {string}
 */
export function rotate_vek() {
  let deferred2_0;
  let deferred2_1;
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    wasm.rotate_vek(retptr);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    var ptr1 = r0;
    var len1 = r1;
    if (r3) {
      ptr1 = 0;
      len1 = 0;
      throw takeObject(r2);
    }
    deferred2_0 = ptr1;
    deferred2_1 = len1;
    return getStringFromWasm0(ptr1, len1);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
    wasm.__wbindgen_export4(deferred2_0, deferred2_1, 1);
  }
}

/**
 * Seal entries into a portable vault under a fresh, file-only key.
 * @param {string} entries_json
 * @param {string} password
 * @param {Uint8Array} magic_version
 * @returns {any}
 */
export function seal_portable_vault(entries_json, password, magic_version) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      entries_json,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      password,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(magic_version, wasm.__wbindgen_export);
    const len2 = WASM_VECTOR_LEN;
    wasm.seal_portable_vault(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Session resume: load a cached VEK (from session storage / the biometric cache)
 * without re-deriving from a credential.
 * @param {string} vek_b64
 */
export function unlock_with_vek(vek_b64) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      vek_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    wasm.unlock_with_vek(retptr, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    if (r1) {
      throw takeObject(r0);
    }
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Full unlock: verify, then unwrap the VEK and load it into memory. Returns
 * false (without mutating state) if the verifier doesn't match.
 * @param {string} password
 * @param {string} salt_b64
 * @param {string} slot_id_b64
 * @param {string} verifier_b64
 * @param {string} wrap_iv_b64
 * @param {string} wrapped_vek_b64
 * @param {Uint8Array} magic_version
 * @returns {boolean}
 */
export function unwrap_vek_password(
  password,
  salt_b64,
  slot_id_b64,
  verifier_b64,
  wrap_iv_b64,
  wrapped_vek_b64,
  magic_version,
) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      password,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      salt_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      slot_id_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(
      verifier_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passStringToWasm0(
      wrap_iv_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passStringToWasm0(
      wrapped_vek_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len5 = WASM_VECTOR_LEN;
    const ptr6 = passArray8ToWasm0(magic_version, wasm.__wbindgen_export);
    const len6 = WASM_VECTOR_LEN;
    wasm.unwrap_vek_password(
      retptr,
      ptr0,
      len0,
      ptr1,
      len1,
      ptr2,
      len2,
      ptr3,
      len3,
      ptr4,
      len4,
      ptr5,
      len5,
      ptr6,
      len6,
    );
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return r0 !== 0;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Full WebAuthn unlock: verify, then unwrap the VEK into memory. Returns false
 * (without mutating state) if the verifier doesn't match.
 * @param {string} hmac_secret_b64
 * @param {string} slot_id_b64
 * @param {string} verifier_b64
 * @param {string} wrap_iv_b64
 * @param {string} wrapped_vek_b64
 * @param {Uint8Array} magic_version
 * @returns {boolean}
 */
export function unwrap_vek_webauthn(
  hmac_secret_b64,
  slot_id_b64,
  verifier_b64,
  wrap_iv_b64,
  wrapped_vek_b64,
  magic_version,
) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      hmac_secret_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      slot_id_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      verifier_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(
      wrap_iv_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passStringToWasm0(
      wrapped_vek_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passArray8ToWasm0(magic_version, wasm.__wbindgen_export);
    const len5 = WASM_VECTOR_LEN;
    wasm.unwrap_vek_webauthn(
      retptr,
      ptr0,
      len0,
      ptr1,
      len1,
      ptr2,
      len2,
      ptr3,
      len3,
      ptr4,
      len4,
      ptr5,
      len5,
    );
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return r0 !== 0;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Verifier-only check (constant-time, no VEK unwrap): does `password` match this
 * slot's stored verifier? Works while the vault is already unlocked.
 * @param {string} password
 * @param {string} salt_b64
 * @param {string} slot_id_b64
 * @param {string} verifier_b64
 * @param {Uint8Array} magic_version
 * @returns {boolean}
 */
export function verify_password_slot(
  password,
  salt_b64,
  slot_id_b64,
  verifier_b64,
  magic_version,
) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      password,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      salt_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      slot_id_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(
      verifier_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArray8ToWasm0(magic_version, wasm.__wbindgen_export);
    const len4 = WASM_VECTOR_LEN;
    wasm.verify_password_slot(
      retptr,
      ptr0,
      len0,
      ptr1,
      len1,
      ptr2,
      len2,
      ptr3,
      len3,
      ptr4,
      len4,
    );
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return r0 !== 0;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Verifier-only check for a WebAuthn slot (constant-time, no VEK unwrap).
 * @param {string} hmac_secret_b64
 * @param {string} slot_id_b64
 * @param {string} verifier_b64
 * @param {Uint8Array} magic_version
 * @returns {boolean}
 */
export function verify_webauthn_slot(
  hmac_secret_b64,
  slot_id_b64,
  verifier_b64,
  magic_version,
) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      hmac_secret_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      slot_id_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      verifier_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(magic_version, wasm.__wbindgen_export);
    const len3 = WASM_VECTOR_LEN;
    wasm.verify_webauthn_slot(
      retptr,
      ptr0,
      len0,
      ptr1,
      len1,
      ptr2,
      len2,
      ptr3,
      len3,
    );
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return r0 !== 0;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Wrap the in-memory VEK under a KEK derived from `password` + `salt`. Returns
 * the slot's verifier, wrapIv, and wrappedVek for the vault header.
 * @param {string} password
 * @param {string} salt_b64
 * @param {string} slot_id_b64
 * @param {Uint8Array} magic_version
 * @returns {any}
 */
export function wrap_vek_password(
  password,
  salt_b64,
  slot_id_b64,
  magic_version,
) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      password,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      salt_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(
      slot_id_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(magic_version, wasm.__wbindgen_export);
    const len3 = WASM_VECTOR_LEN;
    wasm.wrap_vek_password(
      retptr,
      ptr0,
      len0,
      ptr1,
      len1,
      ptr2,
      len2,
      ptr3,
      len3,
    );
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}

/**
 * Wrap the in-memory VEK under a KEK derived from an authenticator hmac-secret.
 * @param {string} hmac_secret_b64
 * @param {string} slot_id_b64
 * @param {Uint8Array} magic_version
 * @returns {any}
 */
export function wrap_vek_webauthn(hmac_secret_b64, slot_id_b64, magic_version) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passStringToWasm0(
      hmac_secret_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(
      slot_id_b64,
      wasm.__wbindgen_export,
      wasm.__wbindgen_export2,
    );
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(magic_version, wasm.__wbindgen_export);
    const len2 = WASM_VECTOR_LEN;
    wasm.wrap_vek_webauthn(retptr, ptr0, len0, ptr1, len1, ptr2, len2);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    if (r2) {
      throw takeObject(r1);
    }
    return takeObject(r0);
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function __wbg_get_imports() {
  const import0 = {
    __proto__: null,
    __wbg_Error_bce6d499ff0a4aff: function (arg0, arg1) {
      const ret = Error(getStringFromWasm0(arg0, arg1));
      return addHeapObject(ret);
    },
    __wbg_Number_b7972a139bfbfdf0: function (arg0) {
      const ret = Number(getObject(arg0));
      return ret;
    },
    __wbg_String_8564e559799eccda: function (arg0, arg1) {
      const ret = String(getObject(arg1));
      const ptr1 = passStringToWasm0(
        ret,
        wasm.__wbindgen_export,
        wasm.__wbindgen_export2,
      );
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_boolean_get_2304fb8c853028c8: function (arg0) {
      const v = getObject(arg0);
      const ret = typeof v === "boolean" ? v : undefined;
      return isLikeNone(ret) ? 0xffffff : ret ? 1 : 0;
    },
    __wbg___wbindgen_debug_string_edece8177ad01481: function (arg0, arg1) {
      const ret = debugString(getObject(arg1));
      const ptr1 = passStringToWasm0(
        ret,
        wasm.__wbindgen_export,
        wasm.__wbindgen_export2,
      );
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_in_07056af4f902c445: function (arg0, arg1) {
      const ret = getObject(arg0) in getObject(arg1);
      return ret;
    },
    __wbg___wbindgen_is_function_5cd60d5cf78b4eef: function (arg0) {
      const ret = typeof getObject(arg0) === "function";
      return ret;
    },
    __wbg___wbindgen_is_object_b4593df85baada48: function (arg0) {
      const val = getObject(arg0);
      const ret = typeof val === "object" && val !== null;
      return ret;
    },
    __wbg___wbindgen_is_string_dde0fd9020db4434: function (arg0) {
      const ret = typeof getObject(arg0) === "string";
      return ret;
    },
    __wbg___wbindgen_is_undefined_35bb9f4c7fd651d5: function (arg0) {
      const ret = getObject(arg0) === undefined;
      return ret;
    },
    __wbg___wbindgen_jsval_loose_eq_0ad77b7717db155c: function (arg0, arg1) {
      const ret = getObject(arg0) == getObject(arg1);
      return ret;
    },
    __wbg___wbindgen_number_get_f73a1244370fcc2c: function (arg0, arg1) {
      const obj = getObject(arg1);
      const ret = typeof obj === "number" ? obj : undefined;
      getDataViewMemory0().setFloat64(
        arg0 + 8 * 1,
        isLikeNone(ret) ? 0 : ret,
        true,
      );
      getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
    },
    __wbg___wbindgen_string_get_d109740c0d18f4d7: function (arg0, arg1) {
      const obj = getObject(arg1);
      const ret = typeof obj === "string" ? obj : undefined;
      var ptr1 = isLikeNone(ret)
        ? 0
        : passStringToWasm0(
            ret,
            wasm.__wbindgen_export,
            wasm.__wbindgen_export2,
          );
      var len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_throw_9c31b086c2b26051: function (arg0, arg1) {
      throw new Error(getStringFromWasm0(arg0, arg1));
    },
    __wbg_call_13665d9f14390edc: function () {
      return handleError(function (arg0, arg1) {
        const ret = getObject(arg0).call(getObject(arg1));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_call_dfde26266607c996: function () {
      return handleError(function (arg0, arg1, arg2) {
        const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_crypto_38df2bab126b63dc: function (arg0) {
      const ret = getObject(arg0).crypto;
      return addHeapObject(ret);
    },
    __wbg_done_54b8da57023b7ed2: function (arg0) {
      const ret = getObject(arg0).done;
      return ret;
    },
    __wbg_getRandomValues_c44a50d8cfdaebeb: function () {
      return handleError(function (arg0, arg1) {
        getObject(arg0).getRandomValues(getObject(arg1));
      }, arguments);
    },
    __wbg_get_3e9a707ab7d352eb: function () {
      return handleError(function (arg0, arg1) {
        const ret = Reflect.get(getObject(arg0), getObject(arg1));
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_get_unchecked_1dfe6d05ad91d9b7: function (arg0, arg1) {
      const ret = getObject(arg0)[arg1 >>> 0];
      return addHeapObject(ret);
    },
    __wbg_get_with_ref_key_6412cf3094599694: function (arg0, arg1) {
      const ret = getObject(arg0)[getObject(arg1)];
      return addHeapObject(ret);
    },
    __wbg_instanceof_ArrayBuffer_53db37b06f6b9afe: function (arg0) {
      let result;
      try {
        result = getObject(arg0) instanceof ArrayBuffer;
      } catch (_) {
        result = false;
      }
      const ret = result;
      return ret;
    },
    __wbg_instanceof_Uint8Array_abd07d4bd221d50b: function (arg0) {
      let result;
      try {
        result = getObject(arg0) instanceof Uint8Array;
      } catch (_) {
        result = false;
      }
      const ret = result;
      return ret;
    },
    __wbg_isArray_94898ed3aad6947b: function (arg0) {
      const ret = Array.isArray(getObject(arg0));
      return ret;
    },
    __wbg_isSafeInteger_01e964d144ad3a55: function (arg0) {
      const ret = Number.isSafeInteger(getObject(arg0));
      return ret;
    },
    __wbg_iterator_1441b47f341dc34f: function () {
      const ret = Symbol.iterator;
      return addHeapObject(ret);
    },
    __wbg_length_2591a0f4f659a55c: function (arg0) {
      const ret = getObject(arg0).length;
      return ret;
    },
    __wbg_length_56fcd3e2b7e0299d: function (arg0) {
      const ret = getObject(arg0).length;
      return ret;
    },
    __wbg_msCrypto_bd5a034af96bcba6: function (arg0) {
      const ret = getObject(arg0).msCrypto;
      return addHeapObject(ret);
    },
    __wbg_new_02d162bc6cf02f60: function () {
      const ret = new Object();
      return addHeapObject(ret);
    },
    __wbg_new_310879b66b6e95e1: function () {
      const ret = new Array();
      return addHeapObject(ret);
    },
    __wbg_new_7ddec6de44ff8f5d: function (arg0) {
      const ret = new Uint8Array(getObject(arg0));
      return addHeapObject(ret);
    },
    __wbg_new_from_slice_269e35316ed2d061: function (arg0, arg1) {
      const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
      return addHeapObject(ret);
    },
    __wbg_new_with_length_99887c91eae4abab: function (arg0) {
      const ret = new Uint8Array(arg0 >>> 0);
      return addHeapObject(ret);
    },
    __wbg_next_2a4e19f4f5083b0f: function (arg0) {
      const ret = getObject(arg0).next;
      return addHeapObject(ret);
    },
    __wbg_next_6429a146bf756f93: function () {
      return handleError(function (arg0) {
        const ret = getObject(arg0).next();
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_node_84ea875411254db1: function (arg0) {
      const ret = getObject(arg0).node;
      return addHeapObject(ret);
    },
    __wbg_process_44c7a14e11e9f69e: function (arg0) {
      const ret = getObject(arg0).process;
      return addHeapObject(ret);
    },
    __wbg_prototypesetcall_5f9bdc8d75e07276: function (arg0, arg1, arg2) {
      Uint8Array.prototype.set.call(
        getArrayU8FromWasm0(arg0, arg1),
        getObject(arg2),
      );
    },
    __wbg_push_b77c476b01548d0a: function (arg0, arg1) {
      const ret = getObject(arg0).push(getObject(arg1));
      return ret;
    },
    __wbg_randomFillSync_6c25eac9869eb53c: function () {
      return handleError(function (arg0, arg1) {
        getObject(arg0).randomFillSync(takeObject(arg1));
      }, arguments);
    },
    __wbg_require_b4edbdcf3e2a1ef0: function () {
      return handleError(function () {
        const ret = module.require;
        return addHeapObject(ret);
      }, arguments);
    },
    __wbg_set_6be42768c690e380: function (arg0, arg1, arg2) {
      getObject(arg0)[takeObject(arg1)] = takeObject(arg2);
    },
    __wbg_set_78ea6a19f4818587: function (arg0, arg1, arg2) {
      getObject(arg0)[arg1 >>> 0] = takeObject(arg2);
    },
    __wbg_set_a0e911be3da02782: function () {
      return handleError(function (arg0, arg1, arg2) {
        const ret = Reflect.set(
          getObject(arg0),
          getObject(arg1),
          getObject(arg2),
        );
        return ret;
      }, arguments);
    },
    __wbg_static_accessor_GLOBAL_THIS_02344c9b09eb08a9: function () {
      const ret = typeof globalThis === "undefined" ? null : globalThis;
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    },
    __wbg_static_accessor_GLOBAL_ac6d4ac874d5cd54: function () {
      const ret = typeof global === "undefined" ? null : global;
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    },
    __wbg_static_accessor_SELF_9b2406c23aeb2023: function () {
      const ret = typeof self === "undefined" ? null : self;
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    },
    __wbg_static_accessor_WINDOW_b34d2126934e16ba: function () {
      const ret = typeof window === "undefined" ? null : window;
      return isLikeNone(ret) ? 0 : addHeapObject(ret);
    },
    __wbg_subarray_7c6a0da8f3b4a1ba: function (arg0, arg1, arg2) {
      const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0);
      return addHeapObject(ret);
    },
    __wbg_value_9cc0518af87a489c: function (arg0) {
      const ret = getObject(arg0).value;
      return addHeapObject(ret);
    },
    __wbg_versions_276b2795b1c6a219: function (arg0) {
      const ret = getObject(arg0).versions;
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000001: function (arg0) {
      // Cast intrinsic for `F64 -> Externref`.
      const ret = arg0;
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000002: function (arg0, arg1) {
      // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
      const ret = getArrayU8FromWasm0(arg0, arg1);
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000003: function (arg0, arg1) {
      // Cast intrinsic for `Ref(String) -> Externref`.
      const ret = getStringFromWasm0(arg0, arg1);
      return addHeapObject(ret);
    },
    __wbindgen_cast_0000000000000004: function (arg0) {
      // Cast intrinsic for `U64 -> Externref`.
      const ret = BigInt.asUintN(64, arg0);
      return addHeapObject(ret);
    },
    __wbindgen_object_clone_ref: function (arg0) {
      const ret = getObject(arg0);
      return addHeapObject(ret);
    },
    __wbindgen_object_drop_ref: function (arg0) {
      takeObject(arg0);
    },
  };
  return {
    __proto__: null,
    "./vault_crypto_bg.js": import0,
  };
}

const FileOpenStreamFinalization =
  typeof FinalizationRegistry === "undefined"
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) => wasm.__wbg_fileopenstream_free(ptr, 1));
const FileSealStreamFinalization =
  typeof FinalizationRegistry === "undefined"
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) => wasm.__wbg_filesealstream_free(ptr, 1));
const KdbxWriterFinalization =
  typeof FinalizationRegistry === "undefined"
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) => wasm.__wbg_kdbxwriter_free(ptr, 1));

function addHeapObject(obj) {
  if (heap_next === heap.length) heap.push(heap.length + 1);
  const idx = heap_next;
  heap_next = heap[idx];

  heap[idx] = obj;
  return idx;
}

function debugString(val) {
  // primitive types
  const type = typeof val;
  if (type == "number" || type == "boolean" || val == null) {
    return `${val}`;
  }
  if (type == "string") {
    return `"${val}"`;
  }
  if (type == "symbol") {
    const description = val.description;
    if (description == null) {
      return "Symbol";
    } else {
      return `Symbol(${description})`;
    }
  }
  if (type == "function") {
    const name = val.name;
    if (typeof name == "string" && name.length > 0) {
      return `Function(${name})`;
    } else {
      return "Function";
    }
  }
  // objects
  if (Array.isArray(val)) {
    const length = val.length;
    let debug = "[";
    if (length > 0) {
      debug += debugString(val[0]);
    }
    for (let i = 1; i < length; i++) {
      debug += ", " + debugString(val[i]);
    }
    debug += "]";
    return debug;
  }
  // Test for built-in
  const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
  let className;
  if (builtInMatches && builtInMatches.length > 1) {
    className = builtInMatches[1];
  } else {
    // Failed to match the standard '[object ClassName]'
    return toString.call(val);
  }
  if (className == "Object") {
    // we're a user defined class or Object
    // JSON.stringify avoids problems with cycles, and is generally much
    // easier than looping through ownProperties of `val`.
    try {
      return "Object(" + JSON.stringify(val) + ")";
    } catch (_) {
      return "Object";
    }
  }
  // errors
  if (val instanceof Error) {
    return `${val.name}: ${val.message}\n${val.stack}`;
  }
  // TODO we could test for more things here, like `Set`s and `Map`s.
  return className;
}

function dropObject(idx) {
  if (idx < 1028) return;
  heap[idx] = heap_next;
  heap_next = idx;
}

function getArrayF64FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
  if (
    cachedDataViewMemory0 === null ||
    cachedDataViewMemory0.buffer.detached === true ||
    (cachedDataViewMemory0.buffer.detached === undefined &&
      cachedDataViewMemory0.buffer !== wasm.memory.buffer)
  ) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  }
  return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
  if (
    cachedFloat64ArrayMemory0 === null ||
    cachedFloat64ArrayMemory0.byteLength === 0
  ) {
    cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
  }
  return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
  return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (
    cachedUint8ArrayMemory0 === null ||
    cachedUint8ArrayMemory0.byteLength === 0
  ) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}

function getObject(idx) {
  return heap[idx];
}

function handleError(f, args) {
  try {
    return f.apply(this, args);
  } catch (e) {
    wasm.__wbindgen_export3(addHeapObject(e));
  }
}

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function isLikeNone(x) {
  return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8ArrayMemory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === undefined) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0()
      .subarray(ptr, ptr + buf.length)
      .set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr;
  }

  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;

  const mem = getUint8ArrayMemory0();

  let offset = 0;

  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 0x7f) break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, (len = offset + arg.length * 3), 1) >>> 0;
    const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
    const ret = cachedTextEncoder.encodeInto(arg, view);

    offset += ret.written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }

  WASM_VECTOR_LEN = offset;
  return ptr;
}

function takeObject(idx) {
  const ret = getObject(idx);
  dropObject(idx);
  return ret;
}

let cachedTextDecoder = new TextDecoder("utf-8", {
  ignoreBOM: true,
  fatal: true,
});
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
  numBytesDecoded += len;
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = new TextDecoder("utf-8", {
      ignoreBOM: true,
      fatal: true,
    });
    cachedTextDecoder.decode();
    numBytesDecoded = len;
  }
  return cachedTextDecoder.decode(
    getUint8ArrayMemory0().subarray(ptr, ptr + len),
  );
}

const cachedTextEncoder = new TextEncoder();

if (!("encodeInto" in cachedTextEncoder)) {
  cachedTextEncoder.encodeInto = function (arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
      read: arg.length,
      written: buf.length,
    };
  };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
  wasmInstance = instance;
  wasm = instance.exports;
  wasmModule = module;
  cachedDataViewMemory0 = null;
  cachedFloat64ArrayMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  return wasm;
}

async function __wbg_load(module, imports) {
  if (typeof Response === "function" && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        const validResponse = module.ok && expectedResponseType(module.type);

        if (
          validResponse &&
          module.headers.get("Content-Type") !== "application/wasm"
        ) {
          console.warn(
            "`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n",
            e,
          );
        } else {
          throw e;
        }
      }
    }

    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);

    if (instance instanceof WebAssembly.Instance) {
      return { instance, module };
    } else {
      return instance;
    }
  }

  function expectedResponseType(type) {
    switch (type) {
      case "basic":
      case "cors":
      case "default":
        return true;
    }
    return false;
  }
}

function initSync(module) {
  if (wasm !== undefined) return wasm;

  if (module !== undefined) {
    if (Object.getPrototypeOf(module) === Object.prototype) {
      ({ module } = module);
    } else {
      console.warn(
        "using deprecated parameters for `initSync()`; pass a single object instead",
      );
    }
  }

  const imports = __wbg_get_imports();
  if (!(module instanceof WebAssembly.Module)) {
    module = new WebAssembly.Module(module);
  }
  const instance = new WebAssembly.Instance(module, imports);
  return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
  if (wasm !== undefined) return wasm;

  if (module_or_path !== undefined) {
    if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
      ({ module_or_path } = module_or_path);
    } else {
      console.warn(
        "using deprecated parameters for the initialization function; pass a single object instead",
      );
    }
  }

  if (module_or_path === undefined) {
    module_or_path = new URL("vault_crypto_bg.wasm", import.meta.url);
  }
  const imports = __wbg_get_imports();

  if (
    typeof module_or_path === "string" ||
    (typeof Request === "function" && module_or_path instanceof Request) ||
    (typeof URL === "function" && module_or_path instanceof URL)
  ) {
    module_or_path = fetch(module_or_path);
  }

  const { instance, module } = await __wbg_load(await module_or_path, imports);

  return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
