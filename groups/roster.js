(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.GroupRoster = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  function clean(name) { return String(name == null ? '' : name).trim().replace(/\s+/g, ' '); }
  function copy(groupsMembers) { return groupsMembers.map(a => a.slice()); }

  function normalizeNames(text) {
    return String(text || '').split(/\r?\n/).map(clean).filter(s => s.length > 0);
  }
  function distributeNames(names, numGroups, membersPerGroup) {
    const n = Math.max(0, Math.floor(Number(numGroups) || 0));
    const m = Math.max(0, Math.floor(Number(membersPerGroup) || 0));
    const groups = [];
    for (let g = 0; g < n; g++) groups.push(names.slice(g * m, g * m + m));
    return { groups, overflow: names.slice(n * m) };
  }
  function moveMember(groupsMembers, fromGroup, memberIndex, toGroup) {
    const next = copy(groupsMembers);
    if (!next[fromGroup] || !next[toGroup] || fromGroup === toGroup) return next;
    if (memberIndex < 0 || memberIndex >= next[fromGroup].length) return next;
    const [name] = next[fromGroup].splice(memberIndex, 1);
    next[toGroup].push(name);
    return next;
  }
  function addMember(groupsMembers, groupIndex, name) {
    const next = copy(groupsMembers);
    const c = clean(name);
    if (next[groupIndex] && c) next[groupIndex].push(c);
    return next;
  }
  function removeMember(groupsMembers, groupIndex, memberIndex) {
    const next = copy(groupsMembers);
    if (next[groupIndex]) next[groupIndex].splice(memberIndex, 1);
    return next;
  }
  function addGroup(groupsMembers) {
    const next = copy(groupsMembers);
    next.push([]);
    return next;
  }
  function removeGroup(groupsMembers, groupIndex) {
    const next = copy(groupsMembers);
    if (groupIndex >= 0 && groupIndex < next.length) next.splice(groupIndex, 1);
    return next;
  }
  return { normalizeNames, distributeNames, moveMember, addMember, removeMember, addGroup, removeGroup };
});
