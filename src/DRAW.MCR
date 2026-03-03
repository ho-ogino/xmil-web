


// ------------------------------------------------------------------ TXT16

#define	TEXT16OUT															\
				__asm {	movzx	esi, ank								}	\
				__asm {	shl		si, 4									}	\
				__asm {	add		esi, offset KNJ_FNT						}	\
				__asm {	mov		edi, v									}	\
				__asm {	movzx	edx, atr								}	\
				__asm {	and		dl, (X1ATR_COLOR or X1ATR_REVERSE)		}	\
				__asm {	movzx	ecx, fontlpcnt							}	\
				__asm {	movzx	eax, byte ptr upt						}	\
				__asm {	and		al, 15									}	\
				__asm {	call	txt16effects[eax*4]						}


#define	FAST_TEXT16OUT														\
				__asm {	mov		ch, 0									}	\
				__asm {	shl		cx, 4									}	\
				__asm {	lea		esi, KNJ_FNT[ecx]						}	\
				__asm {	mov		edi, v									}	\
				__asm {	mov		eax, edx								}	\
				__asm {	and		ax, 15									}	\
				__asm {	mov		dl, dh									}	\
				__asm {	and		dx, (X1ATR_COLOR or X1ATR_REVERSE)		}	\
				__asm {	movzx	ecx, fontlpcnt							}	\
				__asm {	call	txt16effects[eax*4]						}

#define	KANJI16OUT															\
				__asm {	mov		esi, q									}	\
				__asm {	mov		edi, v									}	\
				__asm {	movzx	edx, atr								}	\
				__asm {	and		dl, (X1ATR_COLOR or X1ATR_REVERSE)		}	\
				__asm {	movzx	ecx, fontlpcnt							}	\
				__asm {	movzx	eax, byte ptr upt						}	\
				__asm {	and		al, 15									}	\
				__asm {	call	knj16effects[eax*4]						}


#define	FAST_KANJI16OUT														\
				__asm { bt		cx, 14									}	\
				__asm {	pushf											}	\
				__asm {	push	edx										}	\
				__asm {	call	adr2jis_x1t								}	\
				__asm {	mov		cx, ax									}	\
				__asm {	call	getfontjis								}	\
				__asm {	mov		esi, eax								}	\
				__asm {	pop		edx										}	\
				__asm {	popf											}	\
				__asm {	adc		esi, 0									}	\
				__asm {	mov		edi, v									}	\
				__asm {	mov		eax, edx								}	\
				__asm {	and		ax, 15									}	\
				__asm {	mov		dl, dh									}	\
				__asm {	and		dx, (X1ATR_COLOR or X1ATR_REVERSE)		}	\
				__asm {	movzx	ecx, fontlpcnt							}	\
				__asm {	call	knj16effects[eax*4]						}


#define	TEXT_DOUBLERASTER(n)												\
				__asm {	mov		cl, fontlpcnt							}	\
				__asm {	mov		edi, v									}	\
				__asm {	shl		cl, 1									}	\
				__asm {	dec		cl										}	\
				__asm {	mov		eax, SCREEN_WIDTH						}	\
				__asm {	mul		ecx										}	\
txteffect##n##_lp:															\
				__asm {	mov		edx, [eax+edi+0]						}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*0+0], edx		}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*1+0], edx		}	\
				__asm {	mov		edx, [eax+edi+4]						}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*0+4], edx		}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*1+4], edx		}	\
				__asm {	sub		eax, SCREEN_WIDTH						}	\
				__asm {	jns		txteffect##n##_lp						}


// ------------------------------------------------------------------ PCG

#define	PCG8OUT																\
			__asm {	mov		edi, v										}	\
			__asm {	movzx	ecx, fontlpcnt								}	\
			__asm {	xor		eax, eax									}	\
text8clrlp:																	\
			__asm {	mov		[edi], eax									}	\
			__asm {	mov		[edi+4], eax								}	\
			__asm {	add		edi, SCREEN_WIDTH*2							}	\
			__asm {	loop	text8clrlp									}	\
			__asm {	movzx	esi, ank									}	\
			__asm {	shl		si, 3										}	\
			__asm {	add		esi, offset (pcg.B)							}	\
			__asm {	movzx	eax, byte ptr upt							}	\
			__asm {	and		al, 15										}	\
			__asm {	mov		eax, pcg8effects[eax*4]						}	\
			__asm {	test	atr, 1										}	\
			__asm {	je		pcg8plane_red								}	\
			__asm {	mov		edi, v										}	\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edx, 1										}	\
			__asm {	push	eax											}	\
			__asm {	call	eax											}	\
			__asm {	pop		eax											}	\
pcg8plane_red:																\
			__asm {	add		esi, 256*8									}	\
			__asm {	test	atr, 2										}	\
			__asm {	je		pcg8plane_green								}	\
			__asm {	mov		edi, v										}	\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edx, 2										}	\
			__asm {	push	eax											}	\
			__asm {	call	eax											}	\
			__asm {	pop		eax											}	\
pcg8plane_green:															\
			__asm {	add		esi, 256*8									}	\
			__asm {	test	atr, 4										}	\
			__asm {	je		pcg8plane_effect							}	\
			__asm {	mov		edi, v										}	\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edx, 4										}	\
			__asm {	call	eax											}	\
pcg8plane_effect:


#define	FAST_PCG8OUT														\
			__asm {	mov		edi, v										}	\
			__asm {	lea		esi, pcg.B[ecx*8]							}	\
			__asm {	movzx	ecx, fontlpcnt								}	\
			__asm {	xor		eax, eax									}	\
text8clrlp:																	\
			__asm {	mov		[edi], eax									}	\
			__asm {	mov		[edi+4], eax								}	\
			__asm {	add		edi, SCREEN_WIDTH*2							}	\
			__asm {	loop	text8clrlp									}	\
			__asm {	mov		al, dl										}	\
			__asm {	and		al, 15										}	\
			__asm {	mov		eax, pcg8effects[eax*4]						}	\
			__asm {	mov		atr, dh										}	\
			__asm {	test	dh, 1										}	\
			__asm {	je		pcg8plane_red								}	\
			__asm {	mov		edi, v										}	\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edx, 1										}	\
			__asm {	push	eax											}	\
			__asm {	call	eax											}	\
			__asm {	pop		eax											}	\
pcg8plane_red:																\
			__asm {	add		esi, 256*8									}	\
			__asm {	test	atr, 2										}	\
			__asm {	je		pcg8plane_green								}	\
			__asm {	mov		edi, v										}	\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edx, 2										}	\
			__asm {	push	eax											}	\
			__asm {	call	eax											}	\
			__asm {	pop		eax											}	\
pcg8plane_green:															\
			__asm {	add		esi, 256*8									}	\
			__asm {	test	atr, 4										}	\
			__asm {	je		pcg8plane_effect							}	\
			__asm {	mov		edi, v										}	\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edx, 4										}	\
			__asm {	call	eax											}	\
pcg8plane_effect:



#define	PCG16OUT															\
			__asm {	mov		edi, v										}	\
			__asm {	movzx	ecx, fontlpcnt								}	\
			__asm {	add		cl, cl										}	\
			__asm {	xor		eax, eax									}	\
text16clrlp:																\
			__asm {	mov		[edi], eax									}	\
			__asm {	mov		[edi+4], eax								}	\
			__asm {	add		edi, SCREEN_WIDTH							}	\
			__asm {	loop	text16clrlp									}	\
			__asm {	movzx	esi, ank									}	\
			__asm {	and		si, 0fffeh									}	\
			__asm {	shl		si, 3										}	\
			__asm {	add		esi, offset (pcg.B)							}	\
			__asm {	movzx	eax, byte ptr upt							}	\
			__asm {	and		al, 15										}	\
			__asm {	mov		eax, pcg16effects[eax*4]					}	\
			__asm {	test	atr, 1										}	\
			__asm {	je		pcg16plane_red								}	\
			__asm {	mov		edi, v										}	\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edx, 1										}	\
			__asm {	push	eax											}	\
			__asm {	call	eax											}	\
			__asm {	pop		eax											}	\
pcg16plane_red:																\
			__asm {	add		esi, 256*8									}	\
			__asm {	test	atr, 2										}	\
			__asm {	je		pcg16plane_green							}	\
			__asm {	mov		edi, v										}	\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edx, 2										}	\
			__asm {	push	eax											}	\
			__asm {	call	eax											}	\
			__asm {	pop		eax											}	\
pcg16plane_green:															\
			__asm {	add		esi, 256*8									}	\
			__asm {	test	atr, 4										}	\
			__asm {	je		pcg16plane_effect							}	\
			__asm {	mov		edi, v										}	\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edx, 4										}	\
			__asm {	call	eax											}	\
pcg16plane_effect:


#define	FAST_PCG16OUT														\
			__asm {	mov		edi, v										}	\
			__asm {	and		cl, 0feh									}	\
			__asm {	lea		esi, pcg.B[ecx*8]							}	\
			__asm {	movzx	ecx, fontlpcnt								}	\
			__asm {	add		cl, cl										}	\
			__asm {	xor		eax, eax									}	\
text16clrlp:																\
			__asm {	mov		[edi], eax									}	\
			__asm {	mov		[edi+4], eax								}	\
			__asm {	add		edi, SCREEN_WIDTH							}	\
			__asm {	loop	text16clrlp									}	\
			__asm {	mov		al, dl										}	\
			__asm {	and		al, 15										}	\
			__asm {	mov		eax, pcg16effects[eax*4]					}	\
			__asm {	mov		atr, dh										}	\
			__asm {	test	dh, 1										}	\
			__asm {	je		pcg16plane_red								}	\
			__asm {	mov		edi, v										}	\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edx, 1										}	\
			__asm {	push	eax											}	\
			__asm {	call	eax											}	\
			__asm {	pop		eax											}	\
pcg16plane_red:																\
			__asm {	add		esi, 256*8									}	\
			__asm {	test	atr, 2										}	\
			__asm {	je		pcg16plane_green							}	\
			__asm {	mov		edi, v										}	\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edx, 2										}	\
			__asm {	push	eax											}	\
			__asm {	call	eax											}	\
			__asm {	pop		eax											}	\
pcg16plane_green:															\
			__asm {	add		esi, 256*8									}	\
			__asm {	test	atr, 4										}	\
			__asm {	je		pcg16plane_effect							}	\
			__asm {	mov		edi, v										}	\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edx, 4										}	\
			__asm {	call	eax											}	\
pcg16plane_effect:


// --------------------------------------------------------------------- 効果

#define	TEXT16_REVERSE														\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	add		cl, cl										}	\
			__asm {	mov		eax, 0x38383838								}	\
			__asm {	mov		edi, v										}	\
txt16reverse_lp:															\
			__asm {	xor		[edi+SCREEN_WIDTH*0+0], eax					}	\
			__asm {	xor		[edi+SCREEN_WIDTH*0+4], eax					}	\
			__asm {	add		edi, SCREEN_WIDTH							}	\
			__asm {	loop	txt16reverse_lp								}


#define	PCGEFFECT15KHz(n)													\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edx, 0x40404040								}	\
			__asm {	mov		edi, v										}	\
			__asm {	test	atr, X1ATR_REVERSE							}	\
			__asm {	jne		pcg##n##effects2_lp							}	\
pcg##n##effects1_lp:														\
			__asm {	mov		eax, [edi+SCREEN_WIDTH*0+0]					}	\
			__asm {	add		eax, edx									}	\
			__asm {	mov		[edi+SCREEN_WIDTH*1+0], eax					}	\
			__asm {	mov		eax, [edi+SCREEN_WIDTH*0+4]					}	\
			__asm {	add		eax, edx									}	\
			__asm {	mov		[edi+SCREEN_WIDTH*1+4], eax					}	\
			__asm {	add		edi, SCREEN_WIDTH*2							}	\
			__asm {	loop	pcg##n##effects1_lp							}	\
			__asm {	jmp		pcg##n##effectend							}	\
pcg##n##effects2_lp:														\
			__asm {	xor		dword ptr [edi+SCREEN_WIDTH*0+0], 38383838h	}	\
			__asm {	mov		eax, [edi+SCREEN_WIDTH*0+0]					}	\
			__asm {	add		eax, edx									}	\
			__asm {	mov		[edi+SCREEN_WIDTH*1+0], eax					}	\
			__asm {	xor		dword ptr [edi+SCREEN_WIDTH*0+4], 38383838h	}	\
			__asm {	mov		eax, [edi+SCREEN_WIDTH*0+4]					}	\
			__asm {	add		eax, edx									}	\
			__asm {	mov		[edi+SCREEN_WIDTH*1+4], eax					}	\
			__asm {	add		edi, SCREEN_WIDTH*2							}	\
			__asm {	loop	pcg##n##effects2_lp							}	\
pcg##n##effectend:


#define	PCGEFFECT24KHz														\
			__asm {	mov		cl, fontlpcnt								}	\
			__asm {	mov		edi, v										}	\
			__asm {	test	atr, X1ATR_REVERSE							}	\
			__asm {	jne		pcgeffects2_lp								}	\
pcgeffects1_lp:																\
			__asm {	mov		eax, [edi+SCREEN_WIDTH*0+0]					}	\
			__asm {	mov		[edi+SCREEN_WIDTH*1+0], eax					}	\
			__asm {	mov		eax, [edi+SCREEN_WIDTH*0+4]					}	\
			__asm {	mov		[edi+SCREEN_WIDTH*1+4], eax					}	\
			__asm {	add		edi, SCREEN_WIDTH*2							}	\
			__asm {	loop	pcgeffects1_lp								}	\
			__asm {	jmp		pcgeffectend								}	\
pcgeffects2_lp:																\
			__asm {	xor		dword ptr [edi+SCREEN_WIDTH*0+0], 38383838h	}	\
			__asm {	mov		eax, [edi+SCREEN_WIDTH*0+0]					}	\
			__asm {	mov		[edi+SCREEN_WIDTH*1+0], eax					}	\
			__asm {	xor		dword ptr [edi+SCREEN_WIDTH*0+4], 38383838h	}	\
			__asm {	mov		eax, [edi+SCREEN_WIDTH*0+4]					}	\
			__asm {	mov		[edi+SCREEN_WIDTH*1+4], eax					}	\
			__asm {	add		edi, SCREEN_WIDTH*2							}	\
			__asm {	loop	pcgeffects2_lp								}	\
pcgeffectend:


#define	PCG16_DOUBLERASTER15												\
				__asm {	mov		cl, fontlpcnt							}	\
				__asm {	add		cl, cl									}	\
				__asm {	dec		cl										}	\
				__asm {	mov		eax, SCREEN_WIDTH						}	\
				__asm {	mul		ecx										}	\
				__asm {	mov		edi, v									}	\
				__asm {	test	atr, X1ATR_REVERSE						}	\
				__asm {	je		pcg24doublerast2						}	\
pcg24doublerast1:															\
				__asm {	mov		edx, [eax+edi+0]						}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*0+0], edx		}	\
				__asm {	add		edx, 40404040h							}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*1+0], edx		}	\
				__asm {	mov		edx, [eax+edi+4]						}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*0+4], edx		}	\
				__asm {	add		edx, 40404040h							}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*1+4], edx		}	\
				__asm {	sub		eax, SCREEN_WIDTH						}	\
				__asm {	jns		pcg24doublerast1						}	\
				__asm {	jmp		pcg24doublerastend						}	\
pcg24doublerast2:															\
				__asm {	mov		edx, [eax+edi+0]						}	\
				__asm {	xor		edx, 38383838h							}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*0+0], edx		}	\
				__asm {	add		edx, 40404040h							}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*1+0], edx		}	\
				__asm {	mov		edx, [eax+edi+4]						}	\
				__asm {	xor		edx, 38383838h							}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*0+4], edx		}	\
				__asm {	add		edx, 40404040h							}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*1+4], edx		}	\
				__asm {	sub		eax, SCREEN_WIDTH						}	\
				__asm {	jns		pcg24doublerast2						}	\
pcg24doublerastend:


#define	PCG16_DOUBLERASTER24												\
				__asm {	mov		cl, fontlpcnt							}	\
				__asm {	add		cl, cl									}	\
				__asm {	dec		cl										}	\
				__asm {	mov		eax, SCREEN_WIDTH						}	\
				__asm {	mul		ecx										}	\
				__asm {	mov		edi, v									}	\
				__asm {	test	atr, X1ATR_REVERSE						}	\
				__asm {	je		pcg24doublerast2						}	\
pcg24doublerast1:															\
				__asm {	mov		edx, [eax+edi+0]						}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*0+0], edx		}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*1+0], edx		}	\
				__asm {	mov		edx, [eax+edi+4]						}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*0+4], edx		}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*1+4], edx		}	\
				__asm {	sub		eax, SCREEN_WIDTH						}	\
				__asm {	jns		pcg24doublerast1						}	\
				__asm {	jmp		pcg24doublerastend						}	\
pcg24doublerast2:															\
				__asm {	mov		edx, [eax+edi+0]						}	\
				__asm {	xor		edx, 38383838h							}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*0+0], edx		}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*1+0], edx		}	\
				__asm {	mov		edx, [eax+edi+4]						}	\
				__asm {	xor		edx, 38383838h							}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*0+4], edx		}	\
				__asm {	mov		[eax*2+edi+SCREEN_WIDTH*1+4], edx		}	\
				__asm {	sub		eax, SCREEN_WIDTH						}	\
				__asm {	jns		pcg24doublerast2						}	\
pcg24doublerastend:



#define	VRAMADRRESS_INC														\
				__asm {	inc		esi										}	\
				__asm { add		v, 8									}	\
				__asm {	inc		bl										}	\
				__asm {	cmp		bl, crtc.TXT_XL							}	\
				__asm { jc		linef_end								}	\
				__asm {	movzx	eax, vramylpad							}	\
				__asm { add		bl, bl									}	\
				__asm {	sub		ax, bx									}	\
				__asm {	shl		eax, 2									}	\
				__asm {	add		v, eax									}	\
				__asm {	movzx	eax, vramylpcnt							}	\
				__asm {	test	updatetmp[esi-1], 4						}	\
				__asm {	jne		lastydouble								}	\
				__asm {	mov		fontycnt, al							}	\
lastydouble:																\
				__asm {	add		fontycnt, al							}	\
				__asm {	and		fontycnt, 15							}	\
				__asm {	btr		newline, 0								}	\
				__asm {	jc		dirtyflagset							}	\
				__asm {	add		ax, ax									}	\
				__asm {	add		yp, ax									}	\
				__asm {	jmp		linef_clear								}	\
dirtyflagset:																\
				__asm {	movzx	edi, yp									}	\
dirtyflagsetlp:																\
				__asm {	or		word ptr renewalline[edi], 0303h		}	\
				__asm {	add		edi, 2									}	\
				__asm {	dec		al										}	\
				__asm {	jne		dirtyflagsetlp							}	\
				__asm {	mov		yp, di									}	\
linef_clear:																\
				__asm {	xor		bx, bx									}	\
linef_end:


#define	VRAMADRRESS_INC2													\
				__asm {	inc		esi										}	\
				__asm { add		v, 8									}	\
				__asm {	inc		bl										}	\
				__asm {	cmp		bl, crtc.TXT_XL							}	\
				__asm { jc		linef_end								}	\
				__asm {	movzx	eax, vramylpad							}	\
				__asm { add		bl, bl									}	\
				__asm {	sub		ax, bx									}	\
				__asm {	shl		eax, 2									}	\
				__asm {	add		v, eax									}	\
				__asm {	movzx	eax, vramylpcnt							}	\
				__asm {	test	updatetmp[esi-1], 4						}	\
				__asm {	jne		lastydouble								}	\
				__asm {	mov		fontycnt, al							}	\
lastydouble:																\
				__asm {	add		fontycnt, al							}	\
				__asm {	and		fontycnt, 15							}	\
				__asm {	btr		newline, 0								}	\
				__asm {	jc		dirtyflagset							}	\
				__asm {	shl		ax, 2									}	\
				__asm {	add		yp, ax									}	\
				__asm {	jmp		linef_clear								}	\
dirtyflagset:																\
				__asm {	movzx	edi, yp									}	\
dirtyflagsetlp:																\
				__asm {	or		dword ptr renewalline[edi], 03030303h	}	\
				__asm {	add		edi, 4									}	\
				__asm {	dec		al										}	\
				__asm {	jne		dirtyflagsetlp							}	\
				__asm {	mov		yp, di									}	\
linef_clear:																\
				__asm {	xor		bx, bx									}	\
linef_end:


