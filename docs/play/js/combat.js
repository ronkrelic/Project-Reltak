// Pure dice and combat resolution. No DOM, no three.js, no imports.
// Lean d20 draft: roll + attackBonus vs defense; nat 20 crits (damage dice
// doubled, modifier once), nat 1 always misses. Rebalance here, not in game.js.
export function rollDie(sides){
  return 1+Math.floor(Math.random()*sides);
}
export function rollDice({count=1,sides=6,bonus=0}={}){
  let total=bonus;const rolls=[];
  for(let i=0;i<count;i++){const roll=rollDie(sides);rolls.push(roll);total+=roll;}
  return {total,rolls,bonus};
}
// attacker needs: attackBonus, damage {count, sides, bonus}
// defender needs: defense
export function resolveAttack(attacker,defender,{advantage=false}={}){
  const attackRolls=[rollDie(20)];
  if(advantage)attackRolls.push(rollDie(20));
  const d20=Math.max(...attackRolls);
  const rollInfo={attackRolls,advantage};
  const attackBonus=attacker.attackBonus||0;
  const defense=defender.defense||10;
  const total=d20+attackBonus;
  if(d20===1)return {...rollInfo,hit:false,crit:false,nat1:true,nat20:false,d20,total,attackBonus,defense,damage:0};
  if(d20!==20&&total<defense)return {...rollInfo,hit:false,crit:false,nat1:false,nat20:false,d20,total,attackBonus,defense,damage:0};
  const spec=attacker.damage||{count:1,sides:4,bonus:0};
  const critMult=d20===20?2:1;
  const damage=rollDice({count:spec.count*critMult,sides:spec.sides,bonus:spec.bonus});
  return {...rollInfo,hit:true,crit:d20===20,nat1:false,nat20:d20===20,d20,total,attackBonus,defense,damage:damage.total,damageRolls:damage.rolls};
}
