# What has been checked on real devices

Skin Studio writes the SDK's own `Plugin Skins/` format. Everything below was checked by loading a built skin in MPC OS
on a real device, unless marked otherwise. Devices: an MPC Live III on MPC OS 3.10.1 and an Akai Force on 3.9.1.

| Feature | State |
|---|---|
| Skin loads, tabs appear (the whole-file failure mode) | verified (Live III, Force) |
| Knob / fader / slider / switch / menu from Akai's kit | verified (Akai's own tools produce the same bytes; golden-gated) |
| Momentary button, value readout | verified (Live III) |
| Stepper with the numeric keypad | verified (Live III) |
| `{Increment}` strip page (a run of bars as the tab root) | verified (Force). It only works as a page of its own |
| Installing a skin into an installed plugin (staged swap, other files untouched) | verified (both) |
| Page colours, free-form layout, Q-Link sets, placed images, page artwork | built from documented shapes; checked in the preview, **not each one separately on a device** |
| **Meter** | **not yet verified on a device.** Built exactly as the SDK reference describes (it calls the widget "less tested"). The plugin must write its level into the bound parameter |
| **Value picture** (filmstrip frame follows a parameter) | **not yet verified on a device.** Same shape as the reference's `Image` filmstrip |
| **Mode artwork** (`art when=`) | **not yet verified on a device.** Uses the same show-when mechanism as controls, which is verified |
| Multi-interface skin sets | layout follows the SDK's variants note; engine-side switching is the plugin's job; not device-tested |

If one of the "not yet verified" items does not load on your device, the whole skin may fail to load (no tabs). Please
open an issue with the device, OS version and the built `TUI.json`.
