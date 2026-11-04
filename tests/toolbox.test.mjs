import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseToolboxConfigCsv } from "../src/ui/toolbox-config.js";

const [menuCsv, eventCsv] = await Promise.all([
  readFile(new URL("../src/config/toolbox-menus.csv", import.meta.url), "utf8"),
  readFile(new URL("../src/config/toolbox-events.csv", import.meta.url), "utf8"),
]);

test("版本化工具箱 CSV 提供完整本地基线并计算插入后的光标位置", () => {
  const config = parseToolboxConfigCsv({ menuCsv, eventCsv });
  assert.ok(config.primaryMenus.length > 0);
  assert.ok(config.events.length > 0);
  assert.ok(config.primaryMenus.some((menu) => menu.secondaryMenus.length > 0));
  const doubleIndex = config.events.findIndex(event => event.insertion === "{||}");
  const finalBar = config.events[doubleIndex + 1];
  assert.equal(finalBar.insertion, "{||END}");
  assert.equal(finalBar.zhName, "终止小节线");
  assert.equal(finalBar.enName, "Final Barline");
  assert.equal(finalBar.primaryId, config.events[doubleIndex].primaryId);
  assert.equal(finalBar.cursorOffset, "{||END}".length);
  const tonalities = config.primaryMenus.find((menu) => menu.enName === "Tonalities");
  const dtc = config.events.filter((event) => event.primaryId === tonalities.id).at(-1);
  assert.equal(dtc.insertion, "<DTC:>");
  assert.equal(dtc.cursorOffset, "<DTC:".length);
  assert.deepEqual(
    config.events.filter((event) => ["{BN:}", "{T=}", "[C:|R:]", "[NR:]", "{ENDING:}{/ENDING}"].includes(event.insertion)).map((event) => [event.insertion, event.cursorOffset]),
    [["{BN:}", 4], ["{T=}", 3], ["[C:|R:]", 3], ["[NR:]", 4], ["{ENDING:}{/ENDING}", 8]],
  );
  for (const event of config.events) {
    const primaryMenu = config.primaryMenus.find((menu) => menu.id === event.primaryId);
    assert.ok(primaryMenu, `missing primary menu ${event.primaryId}`);
    if (event.secondaryId) {
      assert.ok(primaryMenu.secondaryMenus.some((menu) => menu.id === event.secondaryId));
    }
  }
});

test("二级菜单按一级菜单归属，并约束事件引用", () => {
  const menus = "一级菜单id,二级菜单id,中文名,英文名\n1,,一级,Primary\n1,2,二级,Secondary\n";
  const events = "插入内容,光标位置,中文名,英文名,一级菜单id,二级菜单id\n{X:},-2,事件,Event,1,2\n";
  const config = parseToolboxConfigCsv({ menuCsv: menus, eventCsv: events });
  assert.equal(config.primaryMenus[0].secondaryMenus[0].id, "2");
  assert.equal(config.events[0].secondaryId, "2");
  assert.throws(
    () => parseToolboxConfigCsv({ menuCsv: menus, eventCsv: events.replace(",1,2", ",1,3") }),
    /missing secondary menu ID 3/,
  );
});

test("工具箱 CSV 拒绝重复菜单、越界光标和错误列数", () => {
  assert.throws(
    () => parseToolboxConfigCsv({ menuCsv: menuCsv.replace("2,,基础事件", "1,,基础事件"), eventCsv }),
    /duplicated/,
  );
  assert.throws(
    () => parseToolboxConfigCsv({ menuCsv, eventCsv: eventCsv.replace("{BN:},-2", "{BN:},20") }),
    /outside the inserted content/,
  );
  assert.throws(
    () => parseToolboxConfigCsv({ menuCsv, eventCsv: eventCsv.replace("X,-1,占位符,Placeholder,2,", "X,-1,占位符,Placeholder,2") }),
    /exactly 6 columns/,
  );
});
