import assert from "assert/strict";
import { filterMetasByHierarchy } from "./metas-filter.js";

function run() {
  const sample = [
    { id: 1, dg_clave: "L00", da_clave: "117", proy_clave: "0108050103", conac: "E", meta: "M1" },
    { id: 2, dg_clave: "L00", da_clave: "117", proy_clave: "0108050103", conac: "I", meta: "M2" },
    { id: 3, dg_clave: "L00", da_clave: "118", proy_clave: "0108050103", conac: "E", meta: "M3" },
    { id: 4, dg_clave: "E00", da_clave: "117", proy_clave: "0108050103", conac: "E", meta: "M4" },
    { id: 5, dg_clave: "L00", da_clave: "117", proy_clave: "0108050104", conac: "E", meta: "M5" },
  ];

  {
    const r = filterMetasByHierarchy(sample, {
      dg_clave: "L00",
      da_clave: "117",
      proy_clave: "0108050103",
      conac: "E",
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 1);
  }

  {
    const r = filterMetasByHierarchy(sample, {
      dg_clave: "l00",
      da_clave: "117",
      proy_clave: "0108050103",
      conac: "e",
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 1);
  }

  {
    const r = filterMetasByHierarchy(sample, { dg_clave: "L00", da_clave: "117" });
    assert.equal(r.length, 3);
    assert.deepEqual(r.map((x) => x.id).sort((a, b) => a - b), [1, 2, 5]);
  }

  {
    const r = filterMetasByHierarchy(sample, {
      dg_clave: "L00",
      da_clave: "117",
      proy_clave: "0108050103",
      conac: "I",
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 2);
  }

  {
    const r = filterMetasByHierarchy(sample, {
      dg_clave: "L00",
      da_clave: "117",
      proy_clave: "0108050103",
      conac: "E",
      extra: "IGNORED",
    });
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 1);
  }

  console.log("[metas-filter.test] OK");
}

run();

