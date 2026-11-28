// Draft combat data. Everything here is a tuning knob; game.js reads it and
// hardcodes nothing about classes. Damage: {count, sides, bonus} = count d sides + bonus.
// fireAt / impactAt are fractions of the attack clip where the blow lands.
export const CREATURES={
  Warrior:{
    hp:12,attackBonus:5,defense:14,damage:{count:1,sides:8,bonus:3},
    attack:{type:'melee',range:2.2,cooldown:0.9,fireAt:0.45,
      clips:{attack:'Melee_1H_Attack_Slice_Diagonal'},
      weapon:{path:'assets/weapons/adventurers/sword_1handed.gltf',slot:'handslotr'}}
  },
  Ranger:{
    hp:10,attackBonus:5,defense:13,damage:{count:1,sides:8,bonus:3},
    attack:{type:'projectile',range:25,cooldown:0.9,fireAt:0.25,speed:30,projectile:'arrow',gravity:true,
      clips:{draw:'Ranged_Bow_Draw',release:'Ranged_Bow_Release'},
      weapon:{path:'assets/weapons/adventurers/bow_withString.gltf',slot:'handslotl'},
      projectileAsset:'assets/weapons/adventurers/arrow_bow.gltf'}
  },
  Mage:{
    hp:8,attackBonus:4,defense:12,damage:{count:1,sides:6,bonus:2},
    attack:{type:'projectile',range:20,cooldown:0.9,fireAt:0.5,speed:15,projectile:'bolt',gravity:false,
      clips:{attack:'Ranged_Magic_Shoot'},
      weapon:{path:'assets/weapons/adventurers/staff.gltf',slot:'handslotr'}}
  },
  Goblin:{
    name:'Goblin',label:'goblin',
    hp:6,attackBonus:2,defense:12,damage:{count:1,sides:4,bonus:0},
    ai:{runSpeed:5,aggroRadius:10,attackReach:1.8,attackCooldown:1.5,impactAt:0.5,staggerSeconds:0.4},
    model:{path:'assets/characters/monsters/Goblin.glb',height:1.1,
      clipSuffixes:{idle:'Idle',run:'Run',attack:'Attack',hit:'HitRecieve',death:'Death'}}
  },
  AshSlinger:{
    name:'Ash Sling Marauder',label:'ash slinger',ranged:true,tint:0x969891,
    hp:5,attackBonus:2,defense:11,damage:{count:1,sides:3,bonus:0},
    ai:{runSpeed:5.1,aggroRadius:10,retreatRange:5,attackReach:12,attackCooldown:3,impactAt:.5,staggerSeconds:.4},
    model:{path:'assets/characters/monsters/Goblin.glb',height:1.1,
      clipSuffixes:{idle:'Idle',run:'Run',attack:'Attack',hit:'HitRecieve',death:'Death'}}
  }
};
