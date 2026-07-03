import { assertEquals } from "jsr:@std/assert@1";
import {
  normalizeMileageMiles,
  normalizeServiceMileageSource,
  serviceMileageSourceLabel,
} from "./service-mileage-source.ts";

Deno.test("normalizeServiceMileageSource maps Reveal and generic GPS aliases", () => {
  assertEquals(normalizeServiceMileageSource("Verizon Reveal"), "verizon_reveal");
  assertEquals(normalizeServiceMileageSource("reveal"), "verizon_reveal");
  assertEquals(normalizeServiceMileageSource("GPS"), "generic_telematics");
  assertEquals(normalizeServiceMileageSource("telematics"), "generic_telematics");
  assertEquals(normalizeServiceMileageSource("manual"), "manual");
  assertEquals(normalizeServiceMileageSource(""), "manual");
});

Deno.test("normalizeMileageMiles accepts positive mileage and rejects blocking values", () => {
  assertEquals(normalizeMileageMiles("14.257"), 14.26);
  assertEquals(normalizeMileageMiles(0), null);
  assertEquals(normalizeMileageMiles(-1), null);
  assertEquals(normalizeMileageMiles("not-a-number"), null);
});

Deno.test("serviceMileageSourceLabel keeps customer-facing source labels stable", () => {
  assertEquals(serviceMileageSourceLabel("verizon_reveal"), "Verizon Reveal");
  assertEquals(serviceMileageSourceLabel("generic_telematics"), "GPS/telematics");
  assertEquals(serviceMileageSourceLabel("manual"), "manual");
});
