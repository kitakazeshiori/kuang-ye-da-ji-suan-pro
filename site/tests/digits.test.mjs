// 数位矩阵纯逻辑单测：node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  splitDigits,
  toText,
  toRawText,
  applyDelete,
  applyInsert,
  selectionText,
  placeOf,
  isDim,
  isZero,
} from "../js/core/digits.js";
import { parseDecimal } from "../js/core/bigreal.js";

const arr = (s) => s.split("");

test("splitDigits：整数右对齐补 0、小数左对齐补 0", () => {
  const r = splitDigits("123.45", 4, 3);
  assert.equal(r.digits.join(""), "0123450");
  assert.equal(r.neg, false);
  const n = splitDigits("-2.5", 3, 2);
  assert.equal(n.digits.join(""), "00250");
  assert.equal(n.neg, true);
});

test("splitDigits：科学计数法、溢出截断与 -0", () => {
  assert.equal(splitDigits("1e3", 4, 2).digits.join(""), "100000");
  assert.equal(splitDigits("0.999", 1, 2).digits.join(""), "099");
  assert.equal(splitDigits("123456", 2, 1).digits.join(""), "560");
  assert.equal(splitDigits("-0", 3, 2).neg, false);
  assert.equal(splitDigits("garbage", 2, 2).digits.join(""), "0000");
});

test("toText / toRawText：紧凑输出与定点输出", () => {
  const r = splitDigits("123.45", 4, 3);
  assert.equal(toText(r.digits, 4, r.neg), "123.45");
  assert.equal(toRawText(r.digits, 4, r.neg), "0123.450");
  assert.equal(toText(splitDigits("12", 4, 2).digits, 4, false), "12");
  const n = splitDigits("-2.5", 3, 2);
  assert.equal(toRawText(n.digits, 3, n.neg), "-002.50");
  assert.equal(toText(arr("0000"), 4, false), "0");
  assert.equal(toText(arr("0000"), 4, true), "0");
});

test("applyDelete：删除后整体左移并在末尾补 0", () => {
  const d = arr("123456");
  assert.equal(applyDelete(d, 1, 3, 6), 1);
  assert.equal(d.join(""), "145600");

  const d2 = arr("123456");
  applyDelete(d2, 5, 6, 6);
  assert.equal(d2.join(""), "123450");

  const d3 = arr("123456");
  assert.equal(applyDelete(d3, 3, 3, 6), 3);
  assert.equal(d3.join(""), "123456");

  const d4 = arr("123456");
  applyDelete(d4, 4, 99, 6);
  assert.equal(d4.join(""), "123400");
});

test("applyInsert：插入右移、溢出丢弃、'.' 跳小数、'-' 取反", () => {
  const d = arr("123400");
  const r = applyInsert(d, 0, "90", 6, 4, false);
  assert.equal(d.join(""), "901234");
  assert.equal(r.caret, 2);

  const d2 = arr("000000");
  const r2 = applyInsert(d2, 0, "7", 6, 3, false);
  assert.equal(d2.join(""), "700000");
  assert.equal(r2.caret, 1);

  const d3 = arr("123456");
  const r3 = applyInsert(d3, 0, "1.", 6, 4, false);
  assert.equal(r3.caret, 4);

  const r4 = applyInsert(arr("000000"), 0, "-", 6, 3, false);
  assert.equal(r4.neg, false);
  const r5 = applyInsert(arr("123000"), 0, "-", 6, 3, false);
  assert.equal(r5.neg, true);
  const r6 = applyInsert(arr("123000"), 0, "-", 6, 3, true);
  assert.equal(r6.neg, false);
});

test("selectionText：跨小数点补 '.'，首位为负补 '-'", () => {
  const r = splitDigits("-12.34", 3, 2);
  assert.equal(selectionText(r.digits, 3, 0, 5, true), "-012.34");
  assert.equal(selectionText(r.digits, 3, 1, 4, true), "12.3");
  assert.equal(selectionText(r.digits, 3, 2, 3, true), "2");
});

test("placeOf / isDim / isZero：位权与前后导 0 的淡显判定", () => {
  assert.equal(placeOf(0, 3), 2);
  assert.equal(placeOf(2, 3), 0);
  assert.equal(placeOf(3, 3), -1);
  assert.equal(placeOf(4, 3), -2);

  const d = arr("001200");
  assert.equal(isDim(d, 1, 3), true);
  assert.equal(isDim(d, 2, 3), false);
  assert.equal(isDim(d, 4, 3), true);
  assert.equal(isDim(arr("001201"), 4, 3), false);

  assert.equal(isZero(arr("000")), true);
  assert.equal(isZero(arr("001")), false);
});

test("与 parseDecimal 语义一致：72 位小数可无损往返", () => {
  const text =
    "0.123456789012345678901234567890123456789012345678901234567890123456789012";
  const r = splitDigits(text, 2, 72);
  assert.equal(r.digits.length, 74);
  assert.equal(toText(r.digits, 2, r.neg), text);
  assert.equal(parseDecimal(toRawText(r.digits, 2, r.neg)).toString(), parseDecimal(text).toString());
});