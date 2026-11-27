// Class kits. Warrior is the existing character-creation id for the fighter.
export const ABILITIES={
 Warrior:[
  {name:'Sword Cut',key:1,type:'attack',cost:'cooldown',flavor:''},
  {name:'Iron Brace',key:2,type:'guard',cost:'combat',reduction:2,flavor:'braces.'},
  {name:'Rally',key:3,type:'heal',cost:'camp',heal:3,flavor:'rallies. Courage returns.'}
 ],
 Ranger:[
  {name:'Bow Shot',key:1,type:'attack',cost:'cooldown',flavor:''},
  {name:'Quarry Focus',key:2,type:'advantage',cost:'combat',flavor:'marks the quarry.'},
  {name:'Binding Arrow',key:3,type:'attack',cost:'camp',root:2.5,flavor:'looses a binding arrow.'}
 ],
 Mage:[
  {name:'Ember Bolt',key:1,type:'attack',cost:'cooldown',flavor:''},
  {name:'Cinder Lance',key:2,type:'attack',cost:'focus',damage:{count:2,sides:4,bonus:0},flavor:'casts Cinder Lance.'},
  {name:'Glass Ward',key:3,type:'guard',cost:'focus-trigger',reduction:3,flavor:'raises a ward of glass.'}
 ]
};
