BYTE __fastcall Z80_RDMEM(WORD adrs);
void __fastcall Z80_WRMEM(WORD adrs, BYTE value);
WORD __fastcall Z80_RDMEM_W(WORD adrs);
void __fastcall Z80_WRMEM_W(WORD adrs, WORD value);


//												ecx == adrsの場合
BYTE __fastcall fast_RDMEM(WORD adrs);
void __fastcall fast_WRMEM(WORD adrs, BYTE value);
WORD __fastcall fast_RDMEM_W(WORD adrs);
void __fastcall fast_WRMEM_W(WORD adrs, WORD value);
