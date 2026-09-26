// The live BitNode 8 state at 2026-09-26T14:47:55.436Z (/tel/exitinputs.txt) and the graft
// candidates of that save (snap-augstats / snap-augprice / snap-prereq,
// unowned, non-special, base price), slimmed to the three channels the exit
// reads — the rest of each augmentation's multipliers folded into one
// `other_sum` so graftTimeMs (log2 of the sum of every non-1 multiplier)
// is unchanged. Player intelligence 114. Used by [GP8].
export const AT = "2026-09-26T14:47:55.436Z"
export const INTELLIGENCE = 114
export const OWNED = ["Magnetism Amplifier","Neural-Retention Enhancement","Hacknet Node Core Direct-Neural Interface","Neurotrainer II","Hacknet Node Kernel Direct-Neural Interface","Combat Rib I","Nuoptimal Nootropic Injector Implant","Augmented Targeting I","Hacknet Node CPU Architecture Neural-Upload","Hacknet Node Cache Architecture Neural-Upload","Hacknet Node NIC Architecture Neural-Upload","Neurotrainer I","Wired Reflexes","NutriGen Implant","NeuroFlux Governor","BitWire","Social Negotiation Assistant (S.N.A)","ADR-V1 Pheromone Gene","Speech Enhancement","Synaptic Enhancement Implant","Cranial Signal Processors - Gen I","Speech Processor Implant","INFRARET Enhancement","Artificial Synaptic Potentiation","Cranial Signal Processors - Gen II","Neural Wit Amplifier","Embedded Netburner Module","Neuregen Gene Modification","DataJack","Cranial Signal Processors - Gen III"]
export const INPUTS = {
 "money": 331216431.9975449,
 "incomePerSec": 25819.182289639342,
 "lifeIncome": 0,
 "hacking": 851,
 "hackingExp": 21160260.788001172,
 "hackingMult": 2.5068773180508255,
 "expPerSec": 3870.05,
 "repPerSec": 12.41283100004365,
 "exitRep": 0,
 "exitFavor": 0,
 "cycleHours": 1.9373333333333334,
 "multGainPerCycle": 1.036710290682303,
 "nextInstallGain": 1.0908028296,
 "installGains": {
  "hacking": 1.0908028296,
  "rep": 1.01000262,
  "income": 1.0380684730421748,
  "exp": 1.161503013
 },
 "persistBaseline": {
  "hacking": 1.0908028296,
  "rep": 1.01000262,
  "income": 1.0380684730421748,
  "exp": 1.161503013
 },
 "eRep": 0,
 "eBudget": 0.0425,
 "exitLevel": 3000,
 "joinMoney": 100000000000,
 "terminalRep": 0,
 "donationCost": null,
 "favorToDonate": 0,
 "flatIncomePerSec": 0,
 "capitalReturnPerSec": 0.00019573013069599637,
 "capitalWarmupH": 0.15851172778723252,
 "capitalFit": "realised: 7 trader run(s) from their start, 306 points over 5.8h of market ticks — growth index = r(T - w), flows excluded",
 "capitalCap": 4986275215634.512,
 "installCash": 250000000,
 "workWhileDonating": true,
 "cadence": {
  "source": "measured",
  "node": 8,
  "lives": 16,
  "why": "measured over 16 lives in BitNode 8"
 }
}
export const CANDIDATES = [{"name":"Synthetic Heart","mults":{"other_sum":4.15},"baseCost":2875000000,"prereqs":[]},{"name":"Synfibril Muscle","mults":{"other_sum":2.6},"baseCost":1125000000,"prereqs":[]},{"name":"NEMEAN Subdermal Weave","mults":{"other_sum":2.2},"baseCost":3250000000,"prereqs":[]},{"name":"Embedded Netburner Module Core V3 Upgrade","mults":{"hacking":1.1,"hacking_exp":1.25,"other_sum":3.55},"baseCost":7500000000,"prereqs":["Embedded Netburner Module Core V2 Upgrade","Embedded Netburner Module Core Implant","Embedded Netburner Module"]},{"name":"Embedded Netburner Module Analyze Engine","mults":{"other_sum":1.1},"baseCost":6000000000,"prereqs":["Embedded Netburner Module"]},{"name":"Embedded Netburner Module Direct Memory Access Upgrade","mults":{"other_sum":2.6},"baseCost":7000000000,"prereqs":["Embedded Netburner Module"]},{"name":"QLink","mults":{"hacking":1.75,"other_sum":8.5},"baseCost":25000000000000,"prereqs":[]},{"name":"Augmented Targeting III","mults":{"other_sum":1.3},"baseCost":115000000,"prereqs":["Augmented Targeting II","Augmented Targeting I"]},{"name":"Combat Rib III","mults":{"other_sum":2.36},"baseCost":120000000,"prereqs":["Combat Rib II","Combat Rib I"]},{"name":"Graphene Bone Lacings","mults":{"other_sum":3.4},"baseCost":4250000000,"prereqs":[]},{"name":"SPTN-97 Gene Modification","mults":{"hacking":1.15,"other_sum":7},"baseCost":4875000000,"prereqs":[]},{"name":"Graphene Bionic Spine Upgrade","mults":{"other_sum":6.4},"baseCost":6000000000,"prereqs":["Bionic Spine"]},{"name":"Graphene Bionic Legs Upgrade","mults":{"other_sum":2.5},"baseCost":4500000000,"prereqs":["Bionic Legs"]},{"name":"Embedded Netburner Module Core Implant","mults":{"hacking":1.07,"hacking_exp":1.07,"other_sum":3.16},"baseCost":2500000000,"prereqs":["Embedded Netburner Module"]},{"name":"Embedded Netburner Module Core V2 Upgrade","mults":{"hacking":1.08,"hacking_exp":1.15,"other_sum":3.4},"baseCost":4500000000,"prereqs":["Embedded Netburner Module Core Implant","Embedded Netburner Module"]},{"name":"PC Direct-Neural Interface","mults":{"hacking":1.08,"other_sum":1.3},"baseCost":3750000000,"prereqs":[]},{"name":"PC Direct-Neural Interface Optimization Submodule","mults":{"hacking":1.1,"other_sum":1.75},"baseCost":4500000000,"prereqs":["PC Direct-Neural Interface"]},{"name":"ECorp HVMind Implant","mults":{"other_sum":3},"baseCost":5500000000,"prereqs":[]},{"name":"Social Dynamics Processor","mults":{"other_sum":2.4},"baseCost":1200000000,"prereqs":[]},{"name":"CordiARC Fusion Reactor","mults":{"other_sum":10.8},"baseCost":5000000000,"prereqs":[]},{"name":"Enhanced Social Interaction Implant","mults":{"other_sum":3.2},"baseCost":1375000000,"prereqs":[]},{"name":"Neuralstimulator","mults":{"hacking_exp":1.12,"other_sum":2.12},"baseCost":3000000000,"prereqs":[]},{"name":"FocusWire","mults":{"hacking_exp":1.05,"other_sum":7.55},"baseCost":900000000,"prereqs":[]},{"name":"ADR-V2 Pheromone Gene","mults":{"faction_rep":1.2,"other_sum":2.3},"baseCost":550000000,"prereqs":[]},{"name":"SmartJaw","mults":{"faction_rep":1.25,"other_sum":4.25},"baseCost":2750000000,"prereqs":[]},{"name":"Augmented Targeting II","mults":{"other_sum":1.2},"baseCost":42500000,"prereqs":["Augmented Targeting I"]},{"name":"Combat Rib II","mults":{"other_sum":2.28},"baseCost":65000000,"prereqs":["Combat Rib I"]},{"name":"Nanofiber Weave","mults":{"other_sum":3.45},"baseCost":125000000,"prereqs":[]},{"name":"Bionic Spine","mults":{"other_sum":4.6},"baseCost":125000000,"prereqs":[]},{"name":"Bionic Legs","mults":{"other_sum":1.6},"baseCost":375000000,"prereqs":[]},{"name":"HyperSight Corneal Implant","mults":{"other_sum":4.56},"baseCost":2750000000,"prereqs":[]},{"name":"Neotra","mults":{"other_sum":4.65},"baseCost":2875000000,"prereqs":[]},{"name":"Neurotrainer III","mults":{"hacking_exp":1.2,"other_sum":6},"baseCost":130000000,"prereqs":[]},{"name":"Power Recirculation Core","mults":{"hacking":1.05,"hacking_exp":1.1,"other_sum":10.75},"baseCost":180000000,"prereqs":[]},{"name":"Xanipher","mults":{"hacking":1.2,"hacking_exp":1.15,"other_sum":11.75},"baseCost":4250000000,"prereqs":[]},{"name":"Hydroflame Left Arm","mults":{"other_sum":2.8},"baseCost":2500000000000,"prereqs":[]},{"name":"Neuronal Densification","mults":{"hacking":1.15,"hacking_exp":1.1,"other_sum":1.03},"baseCost":1375000000,"prereqs":[]},{"name":"nextSENS Gene Modification","mults":{"hacking":1.2,"other_sum":6},"baseCost":1925000000,"prereqs":[]},{"name":"OmniTek InfoLoad","mults":{"hacking":1.2,"hacking_exp":1.25},"baseCost":2875000000,"prereqs":[]},{"name":"Photosynthetic Cells","mults":{"other_sum":5.4},"baseCost":2750000000,"prereqs":[]},{"name":"Artificial Bio-neural Network Implant","mults":{"hacking":1.12,"other_sum":2.18},"baseCost":3000000000,"prereqs":[]},{"name":"Enhanced Myelin Sheathing","mults":{"hacking":1.08,"hacking_exp":1.1,"other_sum":1.03},"baseCost":1375000000,"prereqs":[]},{"name":"PC Direct-Neural Interface NeuroNet Injector","mults":{"hacking":1.1,"other_sum":3.05},"baseCost":7500000000,"prereqs":["PC Direct-Neural Interface"]},{"name":"Neural Accelerator","mults":{"hacking":1.1,"hacking_exp":1.15,"other_sum":1.2},"baseCost":1750000000,"prereqs":[]},{"name":"Cranial Signal Processors - Gen IV","mults":{"other_sum":3.47},"baseCost":1100000000,"prereqs":["Cranial Signal Processors - Gen III","Cranial Signal Processors - Gen II","Cranial Signal Processors - Gen I"]},{"name":"Cranial Signal Processors - Gen V","mults":{"hacking":1.3,"other_sum":3},"baseCost":2250000000,"prereqs":["Cranial Signal Processors - Gen IV","Cranial Signal Processors - Gen III","Cranial Signal Processors - Gen II","Cranial Signal Processors - Gen I"]},{"name":"BitRunners Neurolink","mults":{"hacking":1.15,"hacking_exp":1.2,"other_sum":2.15},"baseCost":4375000000,"prereqs":[]},{"name":"The Black Hand","mults":{"hacking":1.1,"other_sum":4.42},"baseCost":550000000,"prereqs":[]},{"name":"CRTX42-AA Gene Modification","mults":{"hacking":1.08,"hacking_exp":1.15},"baseCost":225000000,"prereqs":[]},{"name":"PCMatrix","mults":{"faction_rep":1.0777,"other_sum":7.1655},"baseCost":2000000000,"prereqs":[]},{"name":"CashRoot Starter Kit","mults":{},"baseCost":125000000,"prereqs":[]},{"name":"DermaForce Particle Barrier","mults":{"other_sum":2.43},"baseCost":50000000,"prereqs":[]},{"name":"The Shadow's Simulacrum","mults":{"faction_rep":1.15,"other_sum":1.15},"baseCost":400000000,"prereqs":[]},{"name":"Unstable Circadian Modulator","mults":{"other_sum":13},"baseCost":5000000000,"prereqs":[]},{"name":"Graphene BrachiBlades Upgrade","mults":{"other_sum":5.2},"baseCost":2500000000,"prereqs":["BrachiBlades"]},{"name":"Eloquence Module","mults":{"other_sum":3.35},"baseCost":250000000,"prereqs":[]},{"name":"Golden Tongue Module","mults":{"other_sum":2.4},"baseCost":125000000,"prereqs":[]},{"name":"HemoRecirculator","mults":{"other_sum":5.4},"baseCost":45000000,"prereqs":[]},{"name":"Graphene Bionic Arms Upgrade","mults":{"other_sum":3.7},"baseCost":3750000000,"prereqs":["Bionic Arms"]},{"name":"The Illustrated Primer","mults":{"other_sum":2.25},"baseCost":3375000000,"prereqs":[]},{"name":"BrachiBlades","mults":{"other_sum":4.55},"baseCost":90000000,"prereqs":[]},{"name":"TITN-41 Gene-Modification Injection","mults":{"other_sum":2.3},"baseCost":190000000,"prereqs":[]},{"name":"LuminCloaking-V1 Skin Implant","mults":{"other_sum":3.18},"baseCost":5000000,"prereqs":[]},{"name":"LuminCloaking-V2 Skin Implant","mults":{"other_sum":4.55},"baseCost":30000000,"prereqs":["LuminCloaking-V1 Skin Implant"]},{"name":"Bionic Arms","mults":{"other_sum":2.6},"baseCost":275000000,"prereqs":[]},{"name":"Glibness Enhancement","mults":{"other_sum":2.3},"baseCost":2500000000,"prereqs":[]},{"name":"SmartSonar Implant","mults":{"other_sum":3.5},"baseCost":75000000,"prereqs":[]},{"name":"Neuroreceptor Management Implant","mults":{},"baseCost":550000000,"prereqs":[]}]
