#!/usr/bin/env python3
# KataGo v1.18.1 "walls" patch: interior off-board points (IPvGO offline nodes).
# A wall is C_WALL inside the board rectangle — exactly what the board's own
# padding is, so liberties, captures, territory and legality treat it as an
# edge. Usage: patch.py <KataGo/cpp>
import sys, pathlib
root = pathlib.Path(sys.argv[1])

def sub(path, old, new, count=1):
    p = root / path
    s = p.read_text()
    n = s.count(old)
    if n != count:
        raise SystemExit(f"{path}: expected {count} of {old[:60]!r}, found {n}")
    p.write_text(s.replace(old, new))

# --- board.h: declare setWall
sub("game/board.h", "  bool setStone(Loc loc, Color color);",
    "  bool setStone(Loc loc, Color color);\n  //IPvGO walls patch: make an EMPTY on-board point with no adjacent stones a wall (an interior edge).\n  bool setWall(Loc loc);")

# --- board.cpp
sub("game/board.cpp", "bool Board::setStone(Loc loc, Color color)\n{",
    """bool Board::setWall(Loc loc)
{
  if(loc < 0 || loc >= MAX_ARR_SIZE || colors[loc] != C_EMPTY)
    return false;
  for(int i = 0; i < 4; i++) {
    Color c = colors[loc + adj_offsets[i]];
    if(c == C_BLACK || c == C_WHITE)
      return false;
  }
  colors[loc] = C_WALL;
  pos_hash ^= ZOBRIST_BOARD_HASH2[loc][C_WALL];
  if(ko_loc == loc)
    ko_loc = NULL_LOC;
  return true;
}

bool Board::setStone(Loc loc, Color color)
{""")
# regenChainsFromColors: interior walls are part of the hash
sub("game/board.cpp", """      if(c == C_BLACK || c == C_WHITE) {
        pos_hash ^= ZOBRIST_BOARD_HASH[loc][c];
        chain_head[loc] = NULL_LOC;
      }""", """      if(c == C_BLACK || c == C_WHITE) {
        pos_hash ^= ZOBRIST_BOARD_HASH[loc][c];
        chain_head[loc] = NULL_LOC;
      }
      else if(c == C_WALL)
        pos_hash ^= ZOBRIST_BOARD_HASH2[loc][C_WALL];""")
# checkConsistency: allow interior walls
sub("game/board.cpp", """      else if(colors[loc] == C_EMPTY) {
        // if(!empty_list.contains(loc))""", """      else if(colors[loc] == C_WALL) {
        tmp_pos_hash ^= ZOBRIST_BOARD_HASH2[loc][C_WALL];
      }
      else if(colors[loc] == C_EMPTY) {
        // if(!empty_list.contains(loc))""")
# calculateArea: a wall is nobody's area
sub("game/board.cpp", """        if(result[loc] == C_EMPTY)
          result[loc] = colors[loc];""", """        if(result[loc] == C_EMPTY && colors[loc] != C_WALL)
          result[loc] = colors[loc];""")
sub("game/board.cpp", """      if(basicArea[loc] == C_EMPTY)
        basicArea[loc] = colors[loc];""", """      if(basicArea[loc] == C_EMPTY && colors[loc] != C_WALL)
        basicArea[loc] = colors[loc];""")

# --- boardhistory.cpp: endGameIfAllPassAlive ignores walls
sub("game/boardhistory.cpp", """      if(area[loc] == C_WHITE)
        boardScore += 1;
      else if(area[loc] == C_BLACK)
        boardScore -= 1;
      else
        return;""", """      if(area[loc] == C_WHITE)
        boardScore += 1;
      else if(area[loc] == C_BLACK)
        boardScore -= 1;
      else if(board.colors[loc] != C_WALL)
        return;""")

# --- nninputs.cpp: feature 0 (on board) is 0 on a wall -> the net's mask
sub("neuralnet/nninputs.cpp", """      //Feature 0 - on board
      setRowBin(rowBin,pos,0, 1.0f, posStride, featureStride);""", """      //Feature 0 - on board
      if(board.colors[loc] != C_WALL)
        setRowBin(rowBin,pos,0, 1.0f, posStride, featureStride);""", count=5)
# getSymBoard: walls first, then stones
sub("neuralnet/nninputs.cpp", """  Loc symKoLoc = Board::NULL_LOC;
  for(int y = 0; y<board.y_size; y++) {
    for(int x = 0; x<board.x_size; x++) {
      Loc loc = Location::getLoc(x,y,board.x_size);
      int symX = flipX ? board.x_size - x - 1 : x;
      int symY = flipY ? board.y_size - y - 1 : y;
      if(transpose)
        std::swap(symX,symY);
      Loc symLoc = Location::getLoc(symX,symY,symBoard.x_size);
      bool suc = symBoard.setStoneFailIfNoLibs(symLoc,board.colors[loc]);""", """  Loc symKoLoc = Board::NULL_LOC;
  for(int y = 0; y<board.y_size; y++) {
    for(int x = 0; x<board.x_size; x++) {
      Loc loc = Location::getLoc(x,y,board.x_size);
      if(board.colors[loc] != C_WALL)
        continue;
      int symX = flipX ? board.x_size - x - 1 : x;
      int symY = flipY ? board.y_size - y - 1 : y;
      if(transpose)
        std::swap(symX,symY);
      bool suc = symBoard.setWall(Location::getLoc(symX,symY,symBoard.x_size));
      testAssert(suc);
    }
  }
  for(int y = 0; y<board.y_size; y++) {
    for(int x = 0; x<board.x_size; x++) {
      Loc loc = Location::getLoc(x,y,board.x_size);
      if(board.colors[loc] == C_WALL)
        continue;
      int symX = flipX ? board.x_size - x - 1 : x;
      int symY = flipY ? board.y_size - y - 1 : y;
      if(transpose)
        std::swap(symX,symY);
      Loc symLoc = Location::getLoc(symX,symY,symBoard.x_size);
      bool suc = symBoard.setStoneFailIfNoLibs(symLoc,board.colors[loc]);""")

# --- analysis.cpp: the "walls" field
sub("command/analysis.cpp", """    "initialStones",
    "moves",""", """    "initialStones",
    "walls",
    "moves",""")
sub("command/analysis.cpp", """      vector<Move> placements;
      if(input.find("initialStones") != input.end()) {""", """      vector<Loc> walls;
      if(input.find("walls") != input.end()) {
        if(!parseBoardLocs(input, "walls", walls, false))
          continue;
      }
      vector<Move> placements;
      if(input.find("initialStones") != input.end()) {""")
sub("command/analysis.cpp", """      Board board(boardXSize,boardYSize);
      for(int i = 0; i<placements.size(); i++) {
        board.setStone(placements[i].loc,placements[i].pla);
      }""", """      Board board(boardXSize,boardYSize);
      bool wallsOk = true;
      for(int i = 0; i<walls.size(); i++) {
        if(!board.setWall(walls[i]))
          wallsOk = false;
      }
      if(!wallsOk) {
        reportErrorForId(rbase.id, "walls", "Duplicate wall location");
        continue;
      }
      for(int i = 0; i<placements.size(); i++) {
        if(board.colors[placements[i].loc] == C_WALL) {
          wallsOk = false;
          break;
        }
        board.setStone(placements[i].loc,placements[i].pla);
      }
      if(!wallsOk) {
        reportErrorForId(rbase.id, "initialStones", "A stone on a wall location");
        continue;
      }""")
print("patched")
