// Akai's example plugins as starting points: their ui.json (verbatim) + parameter tables dumped by the SDK's
// host_sim from the native builds. Parameter metadata only — no Akai artwork.
export const TEMPLATES: Record<string, { label: string; description: string; plugin: string; params: any[]; ui: any }> = {
 "SimpleSynth": {
  "label": "Synth",
  "description": "Akai example: 8-voice subtractive synth",
  "plugin": "Simple Synth",
  "params": [
   {
    "index": 0,
    "name": "Osc1 Wave",
    "display": "Saw",
    "default": 0.666667,
    "kind": "choice",
    "choices": [
     "Sine",
     "Triangle",
     "Saw",
     "Square"
    ]
   },
   {
    "index": 1,
    "name": "Osc1 Octave",
    "display": "0",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 2,
    "name": "Osc1 Level",
    "display": "100",
    "default": 1.0,
    "kind": "int"
   },
   {
    "index": 3,
    "name": "Osc2 Wave",
    "display": "Saw",
    "default": 0.666667,
    "kind": "choice",
    "choices": [
     "Sine",
     "Triangle",
     "Saw",
     "Square"
    ]
   },
   {
    "index": 4,
    "name": "Osc2 Octave",
    "display": "0",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 5,
    "name": "Osc2 Semi",
    "display": "0",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 6,
    "name": "Osc2 Detune",
    "display": "8",
    "default": 0.58,
    "kind": "int"
   },
   {
    "index": 7,
    "name": "Osc2 Level",
    "display": "60",
    "default": 0.6,
    "kind": "int"
   },
   {
    "index": 8,
    "name": "Pulse Width",
    "display": "50",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 9,
    "name": "Glide",
    "display": "0",
    "default": 0.0,
    "kind": "int"
   },
   {
    "index": 10,
    "name": "Bend Range",
    "display": "2",
    "default": 0.0833333,
    "kind": "int"
   },
   {
    "index": 11,
    "name": "Cutoff",
    "display": "4000",
    "default": 0.77889,
    "kind": "int"
   },
   {
    "index": 12,
    "name": "Resonance",
    "display": "20",
    "default": 0.2,
    "kind": "int"
   },
   {
    "index": 13,
    "name": "Filter Mode",
    "display": "LP",
    "default": 0.0,
    "kind": "choice",
    "choices": [
     "LP",
     "BP",
     "HP",
     "Notch"
    ]
   },
   {
    "index": 14,
    "name": "Env Amount",
    "display": "40",
    "default": 0.7,
    "kind": "int"
   },
   {
    "index": 15,
    "name": "Drive",
    "display": "0",
    "default": 0.0,
    "kind": "int"
   },
   {
    "index": 16,
    "name": "Key Track",
    "display": "50",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 17,
    "name": "Filt Attack",
    "display": "5",
    "default": 0.188963,
    "kind": "int"
   },
   {
    "index": 18,
    "name": "Filt Decay",
    "display": "300",
    "default": 0.669679,
    "kind": "int"
   },
   {
    "index": 19,
    "name": "Filt Sustain",
    "display": "20",
    "default": 0.2,
    "kind": "int"
   },
   {
    "index": 20,
    "name": "Filt Release",
    "display": "300",
    "default": 0.669679,
    "kind": "int"
   },
   {
    "index": 21,
    "name": "Amp Attack",
    "display": "5",
    "default": 0.188963,
    "kind": "int"
   },
   {
    "index": 22,
    "name": "Amp Decay",
    "display": "200",
    "default": 0.622073,
    "kind": "int"
   },
   {
    "index": 23,
    "name": "Amp Sustain",
    "display": "80",
    "default": 0.8,
    "kind": "int"
   },
   {
    "index": 24,
    "name": "Amp Release",
    "display": "200",
    "default": 0.622073,
    "kind": "int"
   },
   {
    "index": 25,
    "name": "Volume",
    "display": "-8.0",
    "default": 0.695652,
    "kind": "float"
   },
   {
    "index": 26,
    "name": "Velocity",
    "display": "60",
    "default": 0.6,
    "kind": "int"
   },
   {
    "index": 27,
    "name": "LFO Shape",
    "display": "Sine",
    "default": 0.0,
    "kind": "choice",
    "choices": [
     "Sine",
     "Triangle",
     "Saw",
     "Square",
     "S&H"
    ]
   },
   {
    "index": 28,
    "name": "LFO Rate",
    "display": "5.00",
    "default": 0.719903,
    "kind": "float"
   },
   {
    "index": 29,
    "name": "LFO Sync",
    "display": "Off",
    "default": 0.0,
    "kind": "bool",
    "choices": [
     "Off",
     "On"
    ]
   },
   {
    "index": 30,
    "name": "LFO Div",
    "display": "1/4",
    "default": 0.625,
    "kind": "choice",
    "choices": [
     "1/64",
     "1/32T",
     "1/32",
     "1/16T",
     "1/16",
     "1/8T",
     "1/16D",
     "1/8",
     "1/4T",
     "1/8D",
     "1/4",
     "1/2T",
     "1/4D",
     "1/2",
     "1/2D",
     "1/1",
     "2/1"
    ]
   },
   {
    "index": 31,
    "name": "LFO>Pitch",
    "display": "0.00",
    "default": 0.0,
    "kind": "float"
   },
   {
    "index": 32,
    "name": "LFO>Filter",
    "display": "0",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 33,
    "name": "Wheel Vib",
    "display": "0.50",
    "default": 0.204124,
    "kind": "float"
   }
  ],
  "ui": {
   "pages": [
    {
     "name": "OSC",
     "controls": [
      {
       "param": "Osc1 Wave",
       "widget": "switch"
      },
      {
       "param": "Osc1 Octave",
       "widget": "knob"
      },
      {
       "param": "Osc1 Level",
       "widget": "fader"
      },
      {
       "param": "Glide",
       "widget": "knob"
      },
      {
       "param": "Osc2 Wave",
       "widget": "switch"
      },
      {
       "param": "Osc2 Octave",
       "widget": "knob"
      },
      {
       "param": "Osc2 Semi",
       "widget": "knob"
      },
      {
       "param": "Osc2 Detune",
       "widget": "knob"
      },
      {
       "param": "Osc2 Level",
       "widget": "fader"
      },
      {
       "param": "Pulse Width",
       "widget": "knob"
      },
      {
       "param": "Bend Range",
       "widget": "knob"
      },
      {
       "param": "Volume",
       "widget": "fader"
      }
     ]
    },
    {
     "name": "FILTER",
     "controls": [
      {
       "param": "Cutoff",
       "widget": "knob"
      },
      {
       "param": "Resonance",
       "widget": "knob"
      },
      {
       "param": "Filter Mode",
       "widget": "switch"
      },
      {
       "param": "Drive",
       "widget": "knob"
      },
      {
       "param": "Env Amount",
       "widget": "knob",
       "polarity": "bipolar"
      },
      {
       "param": "Key Track",
       "widget": "knob"
      },
      {
       "widget": "empty"
      },
      {
       "widget": "empty"
      },
      {
       "param": "Filt Attack",
       "widget": "fader"
      },
      {
       "param": "Filt Decay",
       "widget": "fader"
      },
      {
       "param": "Filt Sustain",
       "widget": "fader"
      },
      {
       "param": "Filt Release",
       "widget": "fader"
      }
     ]
    },
    {
     "name": "AMP",
     "controls": [
      {
       "param": "Amp Attack",
       "widget": "fader"
      },
      {
       "param": "Amp Decay",
       "widget": "fader"
      },
      {
       "param": "Amp Sustain",
       "widget": "fader"
      },
      {
       "param": "Amp Release",
       "widget": "fader"
      },
      {
       "param": "Volume",
       "widget": "fader"
      },
      {
       "param": "Velocity",
       "widget": "knob"
      }
     ]
    },
    {
     "name": "LFO",
     "controls": [
      {
       "param": "LFO Shape",
       "widget": "slider",
       "overlay": "menu"
      },
      {
       "param": "LFO Sync",
       "widget": "switch"
      },
      {
       "param": "LFO Rate",
       "widget": "knob",
       "visibleWhen": {
        "param": "LFO Sync",
        "choice": "Off"
       }
      },
      {
       "param": "LFO Div",
       "widget": "slider",
       "overlay": "menu",
       "visibleWhen": {
        "param": "LFO Sync",
        "choice": "On"
       }
      },
      {
       "param": "LFO>Pitch",
       "widget": "knob"
      },
      {
       "param": "LFO>Filter",
       "widget": "knob"
      },
      {
       "param": "Wheel Vib",
       "widget": "knob"
      }
     ]
    }
   ]
  }
 },
 "StereoDelay": {
  "label": "Delay effect",
  "description": "Akai example: stereo delay",
  "plugin": "Stereo Delay",
  "params": [
   {
    "index": 0,
    "name": "Sync",
    "display": "On",
    "default": 1.0,
    "kind": "bool",
    "choices": [
     "Off",
     "On"
    ]
   },
   {
    "index": 1,
    "name": "Division",
    "display": "1/8",
    "default": 0.4375,
    "kind": "choice",
    "choices": [
     "1/64",
     "1/32T",
     "1/32",
     "1/16T",
     "1/16",
     "1/8T",
     "1/16D",
     "1/8",
     "1/4T",
     "1/8D",
     "1/4",
     "1/2T",
     "1/4D",
     "1/2",
     "1/2D",
     "1/1",
     "2/1"
    ]
   },
   {
    "index": 2,
    "name": "Time",
    "display": "350",
    "default": 0.770689,
    "kind": "int"
   },
   {
    "index": 3,
    "name": "Feedback",
    "display": "40",
    "default": 0.4,
    "kind": "int"
   },
   {
    "index": 4,
    "name": "Low Cut",
    "display": "120",
    "default": 0.389076,
    "kind": "int"
   },
   {
    "index": 5,
    "name": "High Cut",
    "display": "6000",
    "default": 0.693426,
    "kind": "int"
   },
   {
    "index": 6,
    "name": "Ping Pong",
    "display": "On",
    "default": 1.0,
    "kind": "bool",
    "choices": [
     "Off",
     "On"
    ]
   },
   {
    "index": 7,
    "name": "Mix",
    "display": "35",
    "default": 0.35,
    "kind": "int"
   }
  ],
  "ui": {
   "kit": "cyan",
   "pages": [
    {
     "name": "DELAY",
     "controls": [
      {
       "param": "Sync",
       "widget": "switch"
      },
      {
       "param": "Division",
       "widget": "slider",
       "overlay": "menu",
       "visibleWhen": {
        "param": "Sync",
        "choice": "On"
       }
      },
      {
       "param": "Time",
       "widget": "knob",
       "visibleWhen": {
        "param": "Sync",
        "choice": "Off"
       }
      },
      {
       "param": "Feedback",
       "widget": "knob"
      },
      {
       "param": "Low Cut",
       "widget": "knob"
      },
      {
       "param": "High Cut",
       "widget": "knob"
      },
      {
       "param": "Ping Pong",
       "widget": "switch"
      },
      {
       "param": "Mix",
       "widget": "fader"
      }
     ]
    }
   ]
  }
 },
 "DrumSynth": {
  "label": "Drum synth",
  "description": "Akai example: drum machine voices",
  "plugin": "Drum Synth",
  "params": [
   {
    "index": 0,
    "name": "Kick Tune",
    "display": "0.0",
    "default": 0.5,
    "kind": "float"
   },
   {
    "index": 1,
    "name": "Kick Decay",
    "display": "50",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 2,
    "name": "Kick Level",
    "display": "80",
    "default": 0.8,
    "kind": "int"
   },
   {
    "index": 3,
    "name": "Snare Tune",
    "display": "0.0",
    "default": 0.5,
    "kind": "float"
   },
   {
    "index": 4,
    "name": "Snare Decay",
    "display": "50",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 5,
    "name": "Snare Level",
    "display": "80",
    "default": 0.8,
    "kind": "int"
   },
   {
    "index": 6,
    "name": "Clap Tune",
    "display": "0.0",
    "default": 0.5,
    "kind": "float"
   },
   {
    "index": 7,
    "name": "Clap Decay",
    "display": "50",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 8,
    "name": "Clap Level",
    "display": "80",
    "default": 0.8,
    "kind": "int"
   },
   {
    "index": 9,
    "name": "CHat Tune",
    "display": "0.0",
    "default": 0.5,
    "kind": "float"
   },
   {
    "index": 10,
    "name": "CHat Decay",
    "display": "50",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 11,
    "name": "CHat Level",
    "display": "80",
    "default": 0.8,
    "kind": "int"
   },
   {
    "index": 12,
    "name": "OHat Tune",
    "display": "0.0",
    "default": 0.5,
    "kind": "float"
   },
   {
    "index": 13,
    "name": "OHat Decay",
    "display": "50",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 14,
    "name": "OHat Level",
    "display": "80",
    "default": 0.8,
    "kind": "int"
   },
   {
    "index": 15,
    "name": "LTom Tune",
    "display": "0.0",
    "default": 0.5,
    "kind": "float"
   },
   {
    "index": 16,
    "name": "LTom Decay",
    "display": "50",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 17,
    "name": "LTom Level",
    "display": "80",
    "default": 0.8,
    "kind": "int"
   },
   {
    "index": 18,
    "name": "HTom Tune",
    "display": "0.0",
    "default": 0.5,
    "kind": "float"
   },
   {
    "index": 19,
    "name": "HTom Decay",
    "display": "50",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 20,
    "name": "HTom Level",
    "display": "80",
    "default": 0.8,
    "kind": "int"
   },
   {
    "index": 21,
    "name": "Perc Tune",
    "display": "0.0",
    "default": 0.5,
    "kind": "float"
   },
   {
    "index": 22,
    "name": "Perc Decay",
    "display": "50",
    "default": 0.5,
    "kind": "int"
   },
   {
    "index": 23,
    "name": "Perc Level",
    "display": "80",
    "default": 0.8,
    "kind": "int"
   },
   {
    "index": 24,
    "name": "Routing",
    "display": "All Main",
    "default": 0.0,
    "kind": "choice",
    "choices": [
     "All Main",
     "Hats>Aux",
     "Split"
    ]
   },
   {
    "index": 25,
    "name": "Master",
    "display": "-6.0",
    "default": 0.73913,
    "kind": "float"
   }
  ],
  "ui": {
   "kit": "amber",
   "pages": [
    {
     "name": "KIT A",
     "controls": [
      {
       "param": "Kick Tune",
       "widget": "knob"
      },
      {
       "param": "Kick Decay",
       "widget": "knob"
      },
      {
       "param": "Kick Level",
       "widget": "fader"
      },
      {
       "param": "Master",
       "widget": "fader"
      },
      {
       "param": "Snare Tune",
       "widget": "knob"
      },
      {
       "param": "Snare Decay",
       "widget": "knob"
      },
      {
       "param": "Snare Level",
       "widget": "fader"
      },
      {
       "param": "Routing",
       "widget": "switch"
      },
      {
       "param": "Clap Tune",
       "widget": "knob"
      },
      {
       "param": "Clap Decay",
       "widget": "knob"
      },
      {
       "param": "Clap Level",
       "widget": "fader"
      },
      "empty",
      {
       "param": "CHat Tune",
       "widget": "knob"
      },
      {
       "param": "CHat Decay",
       "widget": "knob"
      },
      {
       "param": "CHat Level",
       "widget": "fader"
      }
     ]
    },
    {
     "name": "KIT B",
     "controls": [
      {
       "param": "OHat Tune",
       "widget": "knob"
      },
      {
       "param": "OHat Decay",
       "widget": "knob"
      },
      {
       "param": "OHat Level",
       "widget": "fader"
      },
      {
       "param": "Master",
       "widget": "fader"
      },
      {
       "param": "LTom Tune",
       "widget": "knob"
      },
      {
       "param": "LTom Decay",
       "widget": "knob"
      },
      {
       "param": "LTom Level",
       "widget": "fader"
      },
      {
       "param": "Routing",
       "widget": "switch"
      },
      {
       "param": "HTom Tune",
       "widget": "knob"
      },
      {
       "param": "HTom Decay",
       "widget": "knob"
      },
      {
       "param": "HTom Level",
       "widget": "fader"
      },
      "empty",
      {
       "param": "Perc Tune",
       "widget": "knob"
      },
      {
       "param": "Perc Decay",
       "widget": "knob"
      },
      {
       "param": "Perc Level",
       "widget": "fader"
      }
     ]
    }
   ]
  }
 }
};
