#pragma once
#define	SUCCESS		0
#define	FAILURE		1

#ifndef PI
#define PI 3.14159265357989
#endif

#define	LABEL		__declspec(naked)

#define RELEASE(x) 	if (x) {(x)->Release(); (x) = NULL;}

typedef union {
	struct {
		BYTE	b;
		BYTE	g;
		BYTE	r;
		BYTE	f;
	} p;
	BYTE	b[4];
	DWORD	d;
} PALETTE_TABLE;
